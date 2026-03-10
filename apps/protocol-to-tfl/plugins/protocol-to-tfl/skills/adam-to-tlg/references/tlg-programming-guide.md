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

## Table Patterns

### Pattern 1: Population Summary (T-1)

```r
adsl <- read_adam("adsl") %>%
  filter(!is.na(TRT01P), TRT01P != "Screen Failure")

# Create population flags as a long dataset
pop_data <- adsl %>%
  select(USUBJID, TRT01P, ITTFL, SAFFL, EFFFL, COMP24FL) %>%
  pivot_longer(cols = c(ITTFL, SAFFL, EFFFL, COMP24FL),
               names_to = "Population", values_to = "Flag") %>%
  mutate(
    Flag = factor(Flag, levels = c("Y", "N")),
    Population = recode(Population,
      "ITTFL" = "Intent-to-Treat (ITT)",
      "SAFFL" = "Safety",
      "EFFFL" = "Efficacy",
      "COMP24FL" = "Completers Week 24"
    )
  ) %>%
  filter(Flag == "Y")

tbl <- pop_data %>%
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
  filter(ITTFL == "Y") %>%
  add_trt_factor()

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

```r
adsl <- read_adam("adsl") %>%
  filter(ITTFL == "Y") %>%
  mutate(across(c(AGE, WEIGHTBL, HEIGHTBL, BMIBL, MMSETOT, DURDIS, EDUCLVL),
                as.numeric)) %>%
  add_trt_factor()

tbl <- adsl %>%
  tbl_summary(
    by = TRT01P,
    include = c(AGE, AGEGR1, SEX, RACE, MMSETOT, DURDIS, EDUCLVL,
                WEIGHTBL, HEIGHTBL, BMIBL, BMIBLGR1),
    label = list(
      AGE ~ "Age (years)",
      AGEGR1 ~ "Age category",
      SEX ~ "Sex",
      RACE ~ "Race",
      MMSETOT ~ "Mini-Mental State (MMSE)",
      DURDIS ~ "Duration of disease (months)",
      EDUCLVL ~ "Years of education",
      WEIGHTBL ~ "Weight (kg)",
      HEIGHTBL ~ "Height (cm)",
      BMIBL ~ "BMI (kg/m2)",
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

### Pattern 5: ANCOVA Primary Endpoint (T-5)

See `references/statistical-methods-guide.md` for the full ANCOVA + emmeans pattern.

```r
adqs <- read_adam("adqsadas") %>%
  mutate(across(c(AVAL, BASE, CHG, TRT01PN), as.numeric))

# Descriptive statistics by visit
desc_tbl <- adqs %>%
  filter(EFFFL == "Y", ANL01FL == "Y", AVISITN %in% c(0, 24)) %>%
  add_trt_factor() %>%
  tbl_strata(
    strata = AVISIT,
    .tbl_fun = ~ .x %>%
      tbl_summary(
        by = TRT01P,
        include = c(AVAL, CHG),
        statistic = all_continuous() ~ "{mean} ({sd})",
        digits = all_continuous() ~ c(2, 3)
      )
  )

# ANCOVA model (see statistical-methods-guide.md)
# ...
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
    title = "Time to First Dermatological Event by Treatment Group",
    subtitle = "Population: Safety — Study CDISCPILOT01",
    x = "Time (weeks)",
    y = "Event-Free Proportion"
  ) +
  study_theme()

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
