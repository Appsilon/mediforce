# TLG Programming Guide

Code patterns for generating Tables, Listings, and Figures using gtsummary, gt, and ggplot2 from ADaM datasets. These patterns correspond to the mock shell templates in the `mock-tlg-generator` skill.

## Setup Script Pattern (00_setup.R)

```r
# ============================================================
# 00_setup.R — Shared configuration and helpers for TLG generation
# ============================================================

.libPaths(c(
  "/Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/dev_libraries",
  .libPaths()
))

library(gtsummary)
library(gt)
library(ggplot2)
library(dplyr, warn.conflicts = FALSE)
library(tidyr)
library(stringr)
library(survival)
library(ggsurvfit)
library(emmeans)
library(broom)
library(mmrm)

# ---- Paths ----
adam_dir   <- "{path_to_adam_data}"
output_dir <- "{path_to_tlg_outputs}"
dir.create(file.path(output_dir, "tables"), recursive = TRUE, showWarnings = FALSE)
dir.create(file.path(output_dir, "figures"), recursive = TRUE, showWarnings = FALSE)
dir.create(file.path(output_dir, "listings"), recursive = TRUE, showWarnings = FALSE)

# ---- Helper: Read ADaM dataset ----
read_adam <- function(name, adam_path = adam_dir) {
  csv_path  <- file.path(adam_path, paste0(tolower(name), ".csv"))
  json_path <- file.path(adam_path, paste0(tolower(name), ".json"))
  xpt_path  <- file.path(adam_path, paste0(tolower(name), ".xpt"))
  sas_path  <- file.path(adam_path, paste0(tolower(name), ".sas7bdat"))

  if (file.exists(csv_path)) {
    df <- read.csv(csv_path, stringsAsFactors = FALSE)
  } else if (file.exists(json_path)) {
    df <- jsonlite::fromJSON(json_path)
  } else if (file.exists(xpt_path)) {
    df <- haven::read_xpt(xpt_path)
  } else if (file.exists(sas_path)) {
    df <- haven::read_sas(sas_path)
  } else {
    stop(paste("ADaM dataset", name, "not found in", adam_path))
  }

  names(df) <- toupper(names(df))
  df <- df %>% mutate(across(where(is.character), trimws))
  df
}

# ---- Treatment factor with N in labels ----
add_trt_factor <- function(data, trt_var = "TRT01P", ordered_levels = NULL) {
  trt <- data[[trt_var]]
  if (is.null(ordered_levels)) {
    ordered_levels <- sort(unique(trt))
  }
  # Build labels with N
  labels <- sapply(ordered_levels, function(arm) {
    n <- sum(trt == arm, na.rm = TRUE)
    paste0(arm, "\n(N=", n, ")")
  })
  data[[trt_var]] <- factor(trt, levels = ordered_levels, labels = labels)
  data
}

# ---- gtsummary theme ----
set_gtsummary_theme(
  theme_gtsummary_compact(),
  theme_gtsummary_language("en")
)

# ---- ggplot2 theme ----
study_theme <- function() {
  theme_bw(base_size = 11) +
    theme(
      plot.title = element_text(size = 12, face = "bold", hjust = 0),
      plot.subtitle = element_text(size = 10, hjust = 0),
      plot.caption = element_text(size = 8, hjust = 0),
      legend.position = "bottom",
      legend.title = element_blank(),
      panel.grid.minor = element_blank(),
      strip.background = element_rect(fill = "grey95")
    )
}

# ---- Format helpers ----
fmt_pval <- function(p) {
  case_when(
    is.na(p) ~ "",
    p < 0.0001 ~ "<0.0001",
    p < 0.001 ~ formatC(p, format = "f", digits = 4),
    p < 0.01 ~ formatC(p, format = "f", digits = 4),
    TRUE ~ formatC(p, format = "f", digits = 4)
  )
}

fmt_ci <- function(lower, upper, digits = 2) {
  paste0("(", formatC(lower, format = "f", digits = digits),
         ", ", formatC(upper, format = "f", digits = digits), ")")
}

fmt_est_se <- function(est, se, digits = 2) {
  paste0(formatC(est, format = "f", digits = digits),
         " (", formatC(se, format = "f", digits = 3), ")")
}

# ---- Export helpers ----
save_table <- function(tbl, filename, format = "html") {
  gt_tbl <- as_gt(tbl)
  out_path <- file.path(output_dir, "tables", paste0(filename, ".", format))
  gt::gtsave(gt_tbl, out_path)
  cat("Table saved:", out_path, "\n")
  invisible(out_path)
}

save_figure <- function(plot, filename, width = 10, height = 7, dpi = 300) {
  out_path <- file.path(output_dir, "figures", paste0(filename, ".png"))
  ggsave(out_path, plot = plot, width = width, height = height, dpi = dpi)
  cat("Figure saved:", out_path, "\n")
  invisible(out_path)
}

cat("Setup complete.\n")
```

---

## Critical: Population N Computation

**ALWAYS compute population N from ADSL, never from analysis datasets (ADLB, ADQS, ADAE, etc.).** Analysis datasets have multiple rows per subject and will produce inflated N values.

```r
# In 00_setup.R or at the top of each TLG script:
adsl <- read_adam("adsl")
stopifnot(n_distinct(adsl$USUBJID) == nrow(adsl))  # Verify one row per subject

# Pre-compute N for each population
safety_n <- adsl %>% filter(SAFFL == "Y") %>% count(TRT01P) %>% deframe()
itt_n    <- adsl %>% filter(ITTFL == "Y") %>% count(TRT01P) %>% deframe()
eff_n    <- adsl %>% filter(EFFFL == "Y") %>% count(TRT01P) %>% deframe()

# Build column header labels with N from ADSL
trt_order <- c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose")

make_trt_labels <- function(pop_n, levels = trt_order) {
  sapply(levels, function(arm) {
    paste0(arm, "\n(N=", pop_n[arm], ")")
  })
}

# Use in add_trt_factor:
add_trt_factor <- function(data, trt_var = "TRT01P", ordered_levels = trt_order, adsl_n = NULL) {
  trt <- data[[trt_var]]
  if (is.null(ordered_levels)) {
    ordered_levels <- sort(unique(trt))
  }
  # Build labels with N from ADSL (not from data!)
  if (!is.null(adsl_n)) {
    labels <- sapply(ordered_levels, function(arm) {
      paste0(arm, "\n(N=", adsl_n[arm], ")")
    })
  } else {
    # Fallback: compute from data (ONLY use this for ADSL itself)
    labels <- sapply(ordered_levels, function(arm) {
      n <- sum(trt == arm, na.rm = TRUE)
      paste0(arm, "\n(N=", n, ")")
    })
  }
  data[[trt_var]] <- factor(trt, levels = ordered_levels, labels = labels)
  data
}
```

**Usage in every TLG script:**
```r
# For safety tables: use safety_n
adae <- read_adam("adae") %>%
  filter(SAFFL == "Y", TRTEMFL == "Y") %>%
  add_trt_factor(adsl_n = safety_n)

# For efficacy tables: use eff_n
adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y") %>%
  add_trt_factor(adsl_n = eff_n)
```

---

## Table Patterns

### Pattern 1: Population Summary (T-1)

```r
adsl <- read_adam("adsl") %>%
  filter(!is.na(TRT01P), TRT01P != "Screen Failure")

# Compute N from ADSL for column headers
pop_n <- adsl %>% count(TRT01P) %>% deframe()

# Create population flags as a long dataset
# Include COMP24FL (Complete Week 24) and COMP26FL/completion status (Complete Study)
pop_data <- adsl %>%
  mutate(COMP26FL = if_else(EOSSTT == "COMPLETED", "Y", "N")) %>%
  select(USUBJID, TRT01P, ITTFL, SAFFL, EFFFL, COMP24FL, COMP26FL) %>%
  pivot_longer(cols = c(ITTFL, SAFFL, EFFFL, COMP24FL, COMP26FL),
               names_to = "Population", values_to = "Flag") %>%
  mutate(
    Flag = factor(Flag, levels = c("Y", "N")),
    Population = factor(recode(Population,
      "ITTFL" = "Intent-to-Treat (ITT)",
      "SAFFL" = "Safety",
      "EFFFL" = "Efficacy",
      "COMP24FL" = "Complete Week 24",
      "COMP26FL" = "Complete Study"
    ), levels = c("Intent-to-Treat (ITT)", "Safety", "Efficacy",
                  "Complete Week 24", "Complete Study"))
  ) %>%
  filter(Flag == "Y")

tbl <- pop_data %>%
  add_trt_factor(adsl_n = pop_n) %>%
  tbl_summary(
    by = TRT01P,
    include = Population,
    statistic = all_categorical() ~ "{n} ({p}%)"
  ) %>%
  add_overall() %>%
  modify_header(label ~ "**Population**") %>%
  modify_caption("**Table T-1: Summary of Populations**")
```

### Pattern 2: Disposition Summary (T-2)

```r
adsl <- read_adam("adsl") %>%
  filter(ITTFL == "Y")

# Use pre-computed ITT N from ADSL
disp_n <- adsl %>% count(TRT01P) %>% deframe()

adsl <- adsl %>%
  add_trt_factor(adsl_n = disp_n) %>%
  mutate(
    # Derive "Early Termination (prior to Week 24)" flag
    EARLY_TERM = case_when(
      EOSSTT == "DISCONTINUED" & (is.na(COMP24FL) | COMP24FL != "Y") ~ "Y",
      TRUE ~ "N"
    ),
    # Derive "Missing" flag for subjects with unknown status
    MISSING_STATUS = case_when(
      is.na(EOSSTT) | EOSSTT == "" ~ "Y",
      TRUE ~ "N"
    )
  )

tbl <- adsl %>%
  tbl_summary(
    by = TRT01P,
    include = c(EOSSTT, DCSREAS),
    label = list(EOSSTT ~ "End of Study Status",
                 DCSREAS ~ "Reason for Discontinuation"),
    statistic = all_categorical() ~ "{n} ({p}%)",
    missing = "no"
  ) %>%
  add_overall() %>%
  add_p(test = all_categorical() ~ "fisher.test") %>%
  modify_caption("**Table T-2: Summary of End of Study Data**")
```

### Pattern 3: Demographics and Baseline (T-3)

**IMPORTANT:** Match ground truth labels exactly. Use "Age (y)" not "Age (years)", "Race (Origin)" not "Race", etc. Use a two-column structure with Parameter and Statistic columns.

```r
adsl <- read_adam("adsl") %>%
  filter(ITTFL == "Y") %>%
  mutate(across(c(AGE, WEIGHTBL, HEIGHTBL, BMIBL, MMSETOT, DURDIS, EDUCLVL),
                as.numeric))

# Use pre-computed ITT N from ADSL for column headers
demo_n <- adsl %>% count(TRT01P) %>% deframe()

adsl <- adsl %>%
  add_trt_factor(ordered_levels = c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose"),
                 adsl_n = demo_n)

tbl <- adsl %>%
  tbl_summary(
    by = TRT01P,
    include = c(AGE, AGEGR1, SEX, RACE, MMSETOT, DURDIS, DURDSGR1, EDUCLVL,
                WEIGHTBL, HEIGHTBL, BMIBL, BMIBLGR1),
    label = list(
      AGE ~ "Age (y)",
      AGEGR1 ~ "Age category",
      SEX ~ "Sex",
      RACE ~ "Race (Origin)",
      MMSETOT ~ "MMSE",
      DURDIS ~ "Duration of disease",
      DURDSGR1 ~ "Duration of disease group",
      EDUCLVL ~ "Years of education",
      WEIGHTBL ~ "Baseline weight (kg)",
      HEIGHTBL ~ "Baseline height (cm)",
      BMIBL ~ "Baseline BMI",
      BMIBLGR1 ~ "BMI category"
    ),
    statistic = list(
      all_continuous() ~ "{mean} ({sd})",
      all_categorical() ~ "{n} ({p}%)"
    ),
    digits = list(all_continuous() ~ c(1, 2)),
    missing = "no"
  ) %>%
  add_overall() %>%
  add_p(test = list(
    all_continuous() ~ "aov",
    all_categorical() ~ "chisq.test"
  )) %>%
  modify_caption("**Table T-3: Summary of Demographic and Baseline Characteristics**")

# Note on percentage formatting: ground truth uses "xx ( xx%)" format
# If needed, customize with modify_fmt_fun or post-process the gt output
```

### Pattern 4: Subjects by Site (T-4)

```r
adsl <- read_adam("adsl") %>%
  filter(SAFFL == "Y") %>%
  add_trt_factor()

tbl <- adsl %>%
  tbl_summary(
    by = TRT01P,
    include = SITEGR1,
    label = list(SITEGR1 ~ "Pooled Site"),
    statistic = all_categorical() ~ "{n}",
    missing = "no"
  ) %>%
  add_overall() %>%
  modify_caption("**Table T-4: Summary of Number of Subjects by Site**")
```

### Pattern 5: ANCOVA Primary Endpoint (T-5, T-7, T-9, T-11, T-12, T-13)

Used for ADAS-Cog(11) and NPI-X change from baseline analyses. See `references/statistical-methods-guide.md` for the full ANCOVA + emmeans pattern.

**Ground truth structure**: Tables have sections for Baseline, Week N, and Change from Baseline, each with n, Mean (SD). Then LS Mean (SE), LS Mean difference vs Placebo (SE), 95% CI, and p-value.

```r
adqs <- read_adam("adqsadas") %>%
  mutate(across(c(AVAL, BASE, CHG, TRT01PN), as.numeric))

# ALWAYS use pre-computed N from ADSL for column headers
eff_n <- read_adam("adsl") %>% filter(EFFFL == "Y") %>% count(TRT01P) %>% deframe()

# Descriptive statistics by visit
analysis_data <- adqs %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  add_trt_factor(ordered_levels = c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose"),
                 adsl_n = eff_n)

# Build table with these sections:
# 1. Baseline: n, Mean (SD)
# 2. Week 24 (or endpoint visit): n, Mean (SD)
# 3. Change from Baseline: n, Mean (SD)
# 4. LS Mean (SE) from ANCOVA
# 5. LS Mean Difference vs Placebo (SE), 95% CI, p-value
# 6. Dose-response p-value

# ANCOVA model
ancova_data <- analysis_data %>% filter(AVISITN == 24, !is.na(CHG))
ancova_mod <- lm(CHG ~ BASE + TRT01P + SITEGR1, data = ancova_data)
lsmeans <- emmeans::emmeans(ancova_mod, ~ TRT01P)
pairs_result <- emmeans::contrast(lsmeans, method = "trt.vs.ctrl", ref = "Placebo", adjust = "none")
pairs_ci <- confint(pairs_result)

# Assemble results in ground truth format
# Use gt() to build the final table manually for precise control
```

### Pattern 5b: CIBIC+ Frequency Distribution (T-6, T-8, T-10)

CIBIC+ uses ANOVA (no baseline covariate) and displays a 7-point categorical frequency distribution.

```r
adqs_cibc <- read_adam("adqscibc") %>%
  filter(EFFFL == "Y", ANL01FL == "Y", AVISITN == 24) %>%
  mutate(AVALC = factor(AVALC, levels = 1:7, labels = c(
    "1 = Marked improvement", "2 = Moderate improvement",
    "3 = Minimal improvement", "4 = No change",
    "5 = Minimal worsening", "6 = Moderate worsening",
    "7 = Marked worsening"
  )))

# Use ADSL N for headers
eff_n <- read_adam("adsl") %>% filter(EFFFL == "Y") %>% count(TRT01P) %>% deframe()

tbl <- adqs_cibc %>%
  add_trt_factor(ordered_levels = c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose"),
                 adsl_n = eff_n) %>%
  tbl_summary(
    by = TRT01P,
    include = AVALC,
    statistic = all_categorical() ~ "{n} ({p}%)"
  ) %>%
  add_overall()

# ANOVA model (no baseline — CIBIC+ IS the assessment)
anova_mod <- lm(as.numeric(AVAL) ~ TRT01P + SITEGR1, data = adqs_cibc)
lsmeans <- emmeans::emmeans(anova_mod, ~ TRT01P)
pairs_result <- emmeans::contrast(lsmeans, method = "trt.vs.ctrl", ref = "Placebo", adjust = "none")
```

### Pattern 6: TEAE by SOC/PT (T-18)

```r
adae <- read_adam("adae") %>%
  filter(SAFFL == "Y", TRTEMFL == "Y") %>%
  add_trt_factor()

# Count unique subjects per SOC/PT
ae_summary <- adae %>%
  distinct(USUBJID, TRT01P, AEBODSYS, AEDECOD) %>%
  tbl_summary(
    by = TRT01P,
    include = c(AEBODSYS),
    statistic = all_categorical() ~ "{n} ({p}%)",
    sort = all_categorical() ~ "frequency"
  ) %>%
  modify_caption("**Table T-18: Incidence of TEAEs by SOC**")
```

For the full SOC/PT hierarchical display, use a custom approach:

```r
# Build hierarchical AE table
ae_counts <- adae %>%
  filter(AOCCPFL == "Y") %>%  # First occurrence per PT
  group_by(TRT01P, AEBODSYS, AEDECOD) %>%
  summarise(n = n_distinct(USUBJID), .groups = "drop")

# Merge with denominator
denoms <- adae %>%
  distinct(USUBJID, TRT01P) %>%
  count(TRT01P, name = "N")

ae_table <- ae_counts %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(pct = round(100 * n / N, 1),
         display = paste0(n, " (", formatC(pct, format = "f", digits = 1), ")"))
# Then pivot and format with gt
```

### Pattern 7: Lab Summary Statistics (T-20)

```r
adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL)) %>%
  add_trt_factor()

tbl <- adlb %>%
  filter(PARCAT1 == "HEMATOLOGY") %>%
  tbl_strata(
    strata = PARAMCD,
    .tbl_fun = ~ .x %>%
      tbl_summary(
        by = TRT01P,
        include = AVAL,
        statistic = all_continuous() ~ "{mean} ({sd})",
        digits = all_continuous() ~ c(2, 3)
      ),
    .header = "**{strata}**"
  )
```

### Pattern 8: Lab Shift Table (T-23/T-24)

```r
adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y") %>%
  mutate(across(c(BNRIND, ANRIND), ~ factor(.x, levels = c("LOW", "NORMAL", "HIGH"))))

# For each parameter and treatment:
shift_data <- adlb %>%
  filter(!is.na(BNRIND), !is.na(ANRIND), AVISITN > 0) %>%
  count(TRT01P, PARAMCD, BNRIND, ANRIND) %>%
  pivot_wider(names_from = ANRIND, values_from = n, values_fill = 0)

# Format as gt table with row groups by parameter
```

### Pattern 9: Exposure Summary (T-17)

```r
adex <- read_adam("adex") %>%
  filter(SAFFL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL)) %>%
  add_trt_factor()

tbl <- adex %>%
  tbl_strata(
    strata = PARAMCD,
    .tbl_fun = ~ .x %>%
      tbl_summary(
        by = TRT01P,
        include = AVAL,
        statistic = all_continuous() ~ c(
          "{mean} ({sd})", "{median}", "{min}, {max}"
        ),
        digits = all_continuous() ~ 1
      ),
    .header = "**{strata}**"
  ) %>%
  modify_caption("**Table T-17: Summary of Planned Exposure**")
```

### Pattern 10: Concomitant Medications (T-29)

```r
adcm <- read_adam("adcm") %>%
  filter(SAFFL == "Y", CONCOMFL == "Y") %>%
  add_trt_factor()

tbl <- adcm %>%
  distinct(USUBJID, TRT01P, CMCLAS, CMDECOD) %>%
  tbl_summary(
    by = TRT01P,
    include = CMCLAS,
    statistic = all_categorical() ~ "{n} ({p}%)",
    sort = all_categorical() ~ "frequency"
  ) %>%
  add_overall() %>%
  modify_caption("**Table T-29: Concomitant Medications**")
```

### Pattern 11: MMRM Longitudinal Analysis (T-15)

```r
library(mmrm)

adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL02FL == "Y", AVISITN > 0) %>%
  mutate(
    CHG = as.numeric(CHG), BASE = as.numeric(BASE),
    AVISIT = factor(AVISIT), TRT01P = factor(TRT01P),
    SITEGR1 = factor(SITEGR1), USUBJID = factor(USUBJID)
  )

# MMRM model
mmrm_mod <- mmrm(
  formula = CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1 +
    us(AVISIT | USUBJID),
  data = adqs
)

# LS Means at each visit
lsmeans_visit <- emmeans::emmeans(mmrm_mod, ~ TRT01P | AVISIT)
pairs_visit <- emmeans::contrast(lsmeans_visit, method = "trt.vs.ctrl", ref = "Placebo", adjust = "none")
pairs_ci <- confint(pairs_visit)

# Ground truth structure per visit:
# LS Mean, SE, LS Mean Difference vs Placebo, 95% CI, p-value
```

### Pattern 12: AE Tables (T-18, T-19)

Ensure SOC/PT hierarchical rows and Fisher's exact p-values.

```r
adae <- read_adam("adae") %>%
  filter(SAFFL == "Y", TRTEMFL == "Y")

# ALWAYS use ADSL N for denominators
safety_n <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% count(TRT01P) %>% deframe()

# Build hierarchical SOC/PT table
ae_counts <- adae %>%
  distinct(USUBJID, TRT01P, AEBODSYS, AEDECOD) %>%
  group_by(TRT01P, AEBODSYS, AEDECOD) %>%
  summarise(n = n(), .groups = "drop") %>%
  left_join(tibble(TRT01P = names(safety_n), N = unname(safety_n)), by = "TRT01P") %>%
  mutate(pct = round(100 * n / N, 1),
         display = paste0(n, " (", formatC(pct, format = "f", digits = 1), ")"))

# Add Fisher's exact p-values for SOC and PT level
# For each SOC, construct 2xK table and run fisher.test
```

### Pattern 13: Lab Summary and Shift Tables (T-20 to T-25)

```r
adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y")

# Use ADSL N
safety_n <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% count(TRT01P) %>% deframe()

# Lab shift table: baseline vs worst post-baseline
shift_data <- adlb %>%
  filter(!is.na(BNRIND), !is.na(ANRIND), AVISITN > 0) %>%
  mutate(
    BNRIND = factor(BNRIND, levels = c("LOW", "NORMAL", "HIGH")),
    ANRIND = factor(ANRIND, levels = c("LOW", "NORMAL", "HIGH"))
  ) %>%
  count(TRT01P, PARAMCD, PARAM, BNRIND, ANRIND) %>%
  pivot_wider(names_from = ANRIND, values_from = n, values_fill = 0)

# CMH test for each parameter
cmh_results <- adlb %>%
  filter(!is.na(BNRIND), !is.na(ANRIND), AVISITN > 0) %>%
  group_by(PARAMCD) %>%
  summarise(
    cmh_p = tryCatch({
      mantelhaen.test(
        x = factor(ANRIND, levels = c("LOW", "NORMAL", "HIGH")),
        y = factor(TRT01P),
        z = factor(BNRIND)
      )$p.value
    }, error = function(e) NA_real_),
    .groups = "drop"
  )
```

### Pattern 14: Vital Signs Tables (T-26, T-27)

```r
advs <- read_adam("advs") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, BASE, CHG), as.numeric))

# Use ADSL N
safety_n <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% count(TRT01P) %>% deframe()

# Summary by parameter and visit: n, Mean (SD) for value and change from baseline
tbl <- advs %>%
  add_trt_factor(ordered_levels = c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose"),
                 adsl_n = safety_n) %>%
  tbl_strata(
    strata = PARAMCD,
    .tbl_fun = ~ .x %>%
      tbl_strata(
        strata = AVISIT,
        .tbl_fun = ~ .x %>%
          tbl_summary(
            by = TRT01P,
            include = c(AVAL, CHG),
            statistic = all_continuous() ~ "{mean} ({sd})",
            digits = all_continuous() ~ c(1, 2)
          )
      )
  )
```

---

## Figure Patterns

### Pattern: KM Curve with Number at Risk (F-1)

```r
adtte <- read_adam("adtte") %>%
  filter(SAFFL == "Y", PARAMCD == "TTDERM") %>%
  mutate(
    AVAL = as.numeric(AVAL),
    CNSR = as.numeric(CNSR),
    AVAL_W = AVAL / 7  # Convert to weeks
  )

# KM fit
km_fit <- survfit(Surv(AVAL_W, 1 - CNSR) ~ TRT01P, data = adtte)

# ggsurvfit plot
p <- ggsurvfit(km_fit) +
  add_risktable() +
  add_censor_mark(size = 2, alpha = 0.5) +
  scale_x_continuous(breaks = seq(0, 26, 4),
                     limits = c(0, 26)) +
  scale_y_continuous(labels = scales::percent,
                     limits = c(0, 1)) +
  labs(
    title = "Kaplan-Meier Survival Curve: Time to First Dermatological Event",
    subtitle = "Population: Safety — Study CDISCPILOT01",
    x = "Time (weeks)",
    y = "Survival Probability (Event-Free)"
  ) +
  study_theme()

# Add log-rank p-value annotation
logrank <- survdiff(Surv(AVAL_W, 1 - CNSR) ~ TRT01P, data = adtte)
logrank_p <- 1 - pchisq(logrank$chisq, df = length(logrank$n) - 1)

p <- p + annotate("text", x = max(adtte$AVAL_W, na.rm = TRUE) * 0.6,
                   y = 0.15, label = paste("Log-rank test p-value =", fmt_pval(logrank_p)),
                   hjust = 0, size = 3.5)

save_figure(p, "f_01_km_derm", width = 10, height = 7)
```

### Pattern: Forest Plot (Subgroup Analysis)

```r
# For each subgroup, compute HR or treatment effect
# Then use ggplot2 with geom_point + geom_errorbarh

p <- ggplot(forest_data, aes(x = estimate, y = subgroup)) +
  geom_point(size = 3) +
  geom_errorbarh(aes(xmin = lower, xmax = upper), height = 0.2) +
  geom_vline(xintercept = 0, linetype = "dashed") +
  labs(x = "Treatment Effect (LS Mean Difference)",
       y = "", title = "Subgroup Analysis") +
  study_theme()
```

### Pattern: Waterfall Plot (Oncology)

```r
p <- ggplot(tumor_data, aes(x = reorder(USUBJID, -PCHG), y = PCHG, fill = TRT01P)) +
  geom_bar(stat = "identity") +
  geom_hline(yintercept = c(-30, 20), linetype = "dashed", color = "grey40") +
  labs(x = "Subject", y = "Best % Change from Baseline",
       title = "Waterfall Plot: Best Percentage Change in Target Lesions") +
  study_theme() +
  theme(axis.text.x = element_blank(), axis.ticks.x = element_blank())
```

---

## Listing Patterns

### Pattern: Patient Listing

```r
adae <- read_adam("adae") %>%
  filter(SAFFL == "Y", AESER == "Y") %>%
  select(USUBJID, TRT01P, AEDECOD, AEBODSYS, AESEV, ASTDT, AENDT, AEOUT) %>%
  arrange(TRT01P, USUBJID, ASTDT)

tbl <- adae %>%
  gt() %>%
  tab_header(
    title = "Listing: Serious Adverse Events",
    subtitle = "Population: Safety — Study CDISCPILOT01"
  ) %>%
  cols_label(
    USUBJID = "Subject",
    TRT01P = "Treatment",
    AEDECOD = "Preferred Term",
    AEBODSYS = "SOC",
    AESEV = "Severity",
    ASTDT = "Start Date",
    AENDT = "End Date",
    AEOUT = "Outcome"
  )

gt::gtsave(tbl, file.path(output_dir, "listings", "l_01_sae.html"))
```

---

## Tips for Matching Mock Shell Structure

1. **Column order**: Use `modify_column_order()` or `cols_move()` in gt to match the mock shell column layout
2. **Row stubs**: The `include` parameter in `tbl_summary()` controls which rows appear
3. **Footnotes**: Use `modify_footnote()` in gtsummary or `tab_footnote()` in gt
4. **Title/subtitle**: Use `modify_caption()` in gtsummary or `tab_header()` in gt
5. **Decimal precision**: Use `digits` parameter to match the mock shell's `xx.xx` patterns
6. **Total column**: Use `add_overall()` for a Total column
7. **p-values**: Use `add_p()` with appropriate test functions
8. **Sort order**: For AE tables, sort SOC alphabetically and PT by descending frequency within SOC

## Handling Missing or Unexpected Data

1. If a variable doesn't exist in the ADaM dataset, log the issue and skip that row/column
2. If a treatment arm has 0 subjects for a population, still display the column with 0s
3. If a statistical test can't be computed (e.g., all values identical), display "NE" (not estimable)
4. Always check for and handle `NA` values gracefully
