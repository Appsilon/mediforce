# Statistical Methods Guide

R implementations of statistical methods commonly specified in clinical trial TLG shells.

## ANCOVA (Analysis of Covariance)

Used for primary efficacy endpoints: change from baseline with baseline as covariate.

### Basic ANCOVA (T-5 pattern: ADAS-Cog primary analysis)

```r
library(emmeans)

# Prepare data
analysis_data <- adqsadas %>%
  filter(EFFFL == "Y", ANL01FL == "Y", AVISITN == 24, !is.na(CHG)) %>%
  mutate(
    CHG = as.numeric(CHG),
    BASE = as.numeric(BASE),
    TRT01P = factor(TRT01P),
    SITEGR1 = factor(SITEGR1)
  )

# Fit ANCOVA model
ancova_mod <- lm(CHG ~ BASE + TRT01P + SITEGR1, data = analysis_data)

# LS Means by treatment
lsmeans <- emmeans(ancova_mod, ~ TRT01P)
lsmeans_df <- as.data.frame(lsmeans)
# Columns: TRT01P, emmean, SE, df, lower.CL, upper.CL

# Pairwise comparisons
pairs_result <- contrast(lsmeans, method = "pairwise", adjust = "none")
pairs_df <- as.data.frame(pairs_result)
# Columns: contrast, estimate, SE, df, t.ratio, p.value
pairs_ci <- confint(pairs_result)
# Columns: contrast, estimate, SE, df, lower.CL, upper.CL
```

### Dose-Response Test (T-5 pattern)

Treatment coded as continuous variable for dose-response trend test:

```r
# Code treatment as continuous dose
analysis_data <- analysis_data %>%
  mutate(
    TRT_DOSE = case_when(
      TRT01P == "Placebo" ~ 0,
      TRT01P == "Xanomeline Low Dose" ~ 54,
      TRT01P == "Xanomeline High Dose" ~ 81
    )
  )

# Dose-response ANCOVA
dose_mod <- lm(CHG ~ BASE + TRT_DOSE + SITEGR1, data = analysis_data)
dose_summary <- summary(dose_mod)

# p-value for dose-response (coefficient of TRT_DOSE)
dose_pval <- coef(dose_summary)["TRT_DOSE", "Pr(>|t|)"]
```

### Assembling ANCOVA Results into a Table

```r
# Combine descriptive stats + ANCOVA results into a gt table
# 1. Descriptive block: n, Mean(SD) for Baseline, Post-BL, Change
# 2. ANCOVA block: LS Mean, LS Mean (SE)
# 3. Dose-response p-value
# 4. Pairwise comparisons: LS Mean diff (SE), 95% CI, p-value

# Build a data frame for the table
results <- tibble(
  Statistic = c(
    # Descriptive
    "Baseline n", "Baseline Mean (SD)",
    "Week 24 (LOCF) n", "Week 24 (LOCF) Mean (SD)",
    "Change from Baseline n", "Change from Baseline Mean (SD)",
    # ANCOVA
    "LS Mean", "LS Mean (SE)",
    "Dose-response p-value",
    # Pairwise
    "Xan Low - Placebo: Diff (SE)",
    "Xan Low - Placebo: 95% CI",
    "Xan Low - Placebo: p-value",
    "Xan High - Placebo: Diff (SE)",
    "Xan High - Placebo: 95% CI",
    "Xan High - Placebo: p-value"
  ),
  Placebo = c(...),
  `Xanomeline Low Dose` = c(...),
  `Xanomeline High Dose` = c(...)
)

# Format as gt table
results %>%
  gt() %>%
  tab_header(
    title = "Primary Endpoint: ADAS Cog(11) Change from Baseline to Week 24 (LOCF)",
    subtitle = "Population: Efficacy — ANCOVA with baseline, pooled site, treatment"
  ) %>%
  tab_footnote(...)
```

---

## ANOVA (Analysis of Variance)

Used when there is no baseline covariate (e.g., CIBIC+ which has no baseline).

```r
# CIBIC+ has no baseline — it IS the change assessment
anova_mod <- lm(AVAL ~ TRT01P + SITEGR1, data = analysis_data)

# LS Means
lsmeans <- emmeans(anova_mod, ~ TRT01P)

# Pairwise comparisons
pairs_result <- contrast(lsmeans, method = "pairwise", adjust = "none")

# Dose-response version
dose_mod <- lm(AVAL ~ TRT_DOSE + SITEGR1, data = analysis_data)
```

---

## MMRM (Mixed-Effects Model for Repeated Measures)

Used for longitudinal efficacy analyses (T-15 pattern).

```r
library(mmrm)

analysis_data <- adqsadas %>%
  filter(EFFFL == "Y", ANL02FL == "Y", AVISITN > 0) %>%
  mutate(
    CHG = as.numeric(CHG),
    BASE = as.numeric(BASE),
    AVISIT = factor(AVISIT),
    TRT01P = factor(TRT01P),
    SITEGR1 = factor(SITEGR1),
    USUBJID = factor(USUBJID)
  )

# MMRM model
# Fixed effects: TRT01P, AVISIT, TRT01P*AVISIT, BASE, BASE*AVISIT, SITEGR1
# Random: subject (implicitly via repeated measures structure)
# Covariance: unstructured
mmrm_mod <- mmrm(
  formula = CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1 +
    us(AVISIT | USUBJID),
  data = analysis_data
)

# LS Means at each visit
lsmeans_visit <- emmeans(mmrm_mod, ~ TRT01P | AVISIT)

# Pairwise contrasts at each visit
pairs_visit <- contrast(lsmeans_visit, method = "pairwise", adjust = "none")
pairs_ci <- confint(pairs_visit)

# Extract results per visit
for (visit in levels(analysis_data$AVISIT)) {
  visit_pairs <- pairs_ci %>%
    as.data.frame() %>%
    filter(AVISIT == visit)
  # Format into table rows
}
```

### Fallback if MMRM fails to converge

```r
# Try Toeplitz covariance if unstructured fails
tryCatch({
  mmrm_mod <- mmrm(
    formula = CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1 +
      us(AVISIT | USUBJID),
    data = analysis_data
  )
}, error = function(e) {
  message("Unstructured failed, trying Toeplitz")
  mmrm_mod <<- mmrm(
    formula = CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1 +
      toep(AVISIT | USUBJID),
    data = analysis_data
  )
})
```

---

## Fisher's Exact Test

Used for comparing categorical variable proportions between groups (T-2, T-18).

### Via gtsummary

```r
tbl %>% add_p(test = all_categorical() ~ "fisher.test")
```

### Manual (for specific comparisons)

```r
# Compare active vs placebo for a specific AE
tbl_2x2 <- table(
  data$TRT01P %in% c("Xanomeline High Dose"),
  data$had_event
)
fisher_result <- fisher.test(tbl_2x2)
p_value <- fisher_result$p.value
```

---

## Pearson's Chi-Square Test

Used for demographics categorical variables (T-3).

```r
tbl %>% add_p(test = all_categorical() ~ "chisq.test")
```

---

## Cochran-Mantel-Haenszel (CMH) Test

Used for stratified categorical analyses (e.g., shift tables).

### Basic CMH test
```r
# CMH test stratified by baseline status
cmh_result <- mantelhaen.test(
  x = factor(data$ANRIND),
  y = factor(data$TRT01P),
  z = factor(data$BNRIND)
)
p_value <- cmh_result$p.value
```

### CMH integration with lab shift tables (T-23/T-24)

For lab shift tables, the CMH test compares the distribution of post-baseline normal range indicators across treatment groups, stratified by baseline normal range indicator:

```r
# For each lab parameter, compute CMH p-value
cmh_by_param <- adlb %>%
  filter(SAFFL == "Y", !is.na(BNRIND), !is.na(ANRIND), AVISITN > 0) %>%
  group_by(PARAMCD, PARAM) %>%
  summarise(
    cmh_pval = tryCatch({
      tbl <- table(
        factor(ANRIND, levels = c("LOW", "NORMAL", "HIGH")),
        factor(TRT01P, levels = c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose")),
        factor(BNRIND, levels = c("LOW", "NORMAL", "HIGH"))
      )
      # Remove empty strata
      tbl <- tbl[, , apply(tbl, 3, sum) > 0, drop = FALSE]
      if (dim(tbl)[3] > 0 && all(dim(tbl)[1:2] > 1)) {
        mantelhaen.test(tbl)$p.value
      } else {
        NA_real_
      }
    }, error = function(e) NA_real_),
    .groups = "drop"
  )

# Add CMH p-values to shift table footnote or as a column
# Format: "CMH p-value = 0.0234" or "<0.0001"
cmh_by_param <- cmh_by_param %>%
  mutate(cmh_display = fmt_pval(cmh_pval))
```

### CMH via cardx (alternative)
```r
# Using cardx package for a tidyverse-friendly CMH
library(cardx)
cmh_result <- ard_stats_cmh_test(
  data = adlb,
  by = TRT01P,
  variables = ANRIND,
  strata = BNRIND
)
```

---

## Kaplan-Meier Analysis

Used for time-to-event endpoints (F-1).

### KM Estimation

```r
library(survival)
library(ggsurvfit)

# Fit KM
km_fit <- survfit(
  Surv(AVAL, 1 - CNSR) ~ TRT01P,
  data = adtte
)

# Summary statistics
km_summary <- surv_summary(km_fit)
# Median survival, CI
km_median <- surv_median(km_fit)
```

### KM Plot with ggsurvfit

```r
p <- ggsurvfit(km_fit, linewidth = 0.8) +
  add_risktable(
    risktable_stats = "n.risk",
    size = 3
  ) +
  add_censor_mark(size = 2, alpha = 0.5) +
  add_quantile(y_value = 0.5, linetype = "dashed", color = "grey40") +
  scale_x_continuous(
    breaks = seq(0, max_time, by = interval),
    limits = c(0, max_time)
  ) +
  scale_y_continuous(
    labels = scales::percent,
    limits = c(0, 1)
  ) +
  labs(
    title = "Title",
    subtitle = "Population: Safety",
    x = "Time (weeks)",
    y = "Event-Free Proportion"
  ) +
  study_theme()
```

### Log-Rank Test

```r
logrank <- survdiff(Surv(AVAL, 1 - CNSR) ~ TRT01P, data = adtte)
logrank_p <- 1 - pchisq(logrank$chisq, df = length(logrank$n) - 1)
```

### Log-Rank P-Value Annotation on KM Figures

Always annotate KM figures with the log-rank p-value. The annotation must include the words "log-rank" explicitly:

```r
# After creating the ggsurvfit plot:
logrank <- survdiff(Surv(AVAL, 1 - CNSR) ~ TRT01P, data = plot_data)
logrank_p <- 1 - pchisq(logrank$chisq, df = length(logrank$n) - 1)

# Add annotation to KM plot
p <- p + annotate(
  "text",
  x = max(plot_data$AVAL, na.rm = TRUE) * 0.5,
  y = 0.15,
  label = paste0("Log-rank test p-value = ", fmt_pval(logrank_p)),
  hjust = 0, size = 3.5
)

# Also include in title: "Kaplan-Meier Survival Curve" (must include "survival")
```

### Cox Proportional Hazards

```r
cox_mod <- coxph(Surv(AVAL, 1 - CNSR) ~ TRT01P, data = adtte)
cox_summary <- summary(cox_mod)
# HR, 95% CI, p-value
hr <- exp(coef(cox_mod))
hr_ci <- exp(confint(cox_mod))
```

---

## Descriptive Statistics Patterns

### Continuous variable summary

```r
tbl_summary(
  data,
  by = TRT01P,
  include = c(AGE, WEIGHTBL),
  statistic = all_continuous() ~ "{n}\n{mean} ({sd})\n{median}\n{min}, {max}",
  digits = all_continuous() ~ c(0, 1, 2, 1, 1, 1)
)
```

### Categorical variable summary

```r
tbl_summary(
  data,
  by = TRT01P,
  include = c(SEX, RACE, AGEGR1),
  statistic = all_categorical() ~ "{n} ({p}%)",
  digits = all_categorical() ~ c(0, 1)
)
```

### Frequency distribution (e.g., CIBIC+ 1-7 scale)

```r
data %>%
  mutate(AVALC = factor(AVALC, levels = 1:7, labels = c(
    "1 = Marked improvement", "2 = Moderate improvement",
    "3 = Minimal improvement", "4 = No change",
    "5 = Minimal worsening", "6 = Moderate worsening",
    "7 = Marked worsening"
  ))) %>%
  tbl_summary(
    by = TRT01P,
    include = AVALC,
    statistic = all_categorical() ~ "{n} ({p}%)"
  )
```

---

## Combining Multiple Analyses in One Table

For tables like T-5 that combine descriptive stats + ANCOVA results:

### Approach 1: Build gt table manually

```r
# Compute all pieces separately, then assemble into a tibble
# and render with gt()
results_df <- bind_rows(desc_rows, ancova_rows, pairwise_rows)

results_df %>%
  gt(groupname_col = "section") %>%
  tab_header(...) %>%
  tab_footnote(...) %>%
  tab_source_note(...)
```

### Approach 2: Use tbl_merge / tbl_stack

```r
# Stack multiple gtsummary tables
tbl_stack(list(desc_tbl, ancova_tbl), group_header = c("Descriptive", "ANCOVA"))
```

### Approach 3: Custom gtsummary with add_stat

```r
tbl_summary(...) %>%
  add_stat(
    fns = all_continuous() ~ function(data, variable, by, ...) {
      # Custom statistic computation
    }
  )
```

---

## Formatting Conventions

### P-values
- Display 4 decimal places: `0.0234`
- If < 0.0001: display `<0.0001`
- Use `fmt_pval()` helper from setup

### Confidence Intervals
- Display as `(lower, upper)` with 2 decimal places
- Use `fmt_ci()` helper from setup

### LS Means
- Display LS Mean with 2 decimal places
- Display LS Mean (SE) with 2 decimal places for mean, 3 for SE
- Use `fmt_est_se()` helper from setup

### Counts and Percentages
- Display as `n (xx.x%)` with 1 decimal for percentage
- Denominator = population N for the arm (not total events)

### Decimal Precision
- Match mock shell patterns:
  - `xx` = integer
  - `xx.x` = 1 decimal
  - `xx.xx` = 2 decimals
  - `xx.xxx` = 3 decimals
  - `x.xxxx` = 4 decimals (p-values)
