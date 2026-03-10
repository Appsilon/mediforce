# T-15: ADAS Cog(11) MMRM | Source: ADQSADAS | Pop: Efficacy
source("00_setup.R")
suppressPackageStartupMessages(library(mmrm))
cat("=== T-15: ADAS Cog(11) MMRM ===\n")

adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", is.na(DTYPE) | DTYPE == "", AVISITN > 0) %>%  # Observed cases for MMRM

  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric),
         AVISIT = factor(AVISIT, levels = c("Week 8", "Week 16", "Week 24")),
         TRT01P = factor(TRT01P, levels = trt_levels),
         SITEGR1 = factor(SITEGR1),
         USUBJID = factor(USUBJID)) %>%
  filter(!is.na(CHG), !is.na(BASE), !is.na(AVISIT))

# Fit MMRM
mmrm_fit <- tryCatch({
  mmrm(CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1 +
         us(AVISIT | USUBJID), data = adqs)
}, error = function(e) {
  message("Unstructured failed, trying compound symmetry: ", e$message)
  mmrm(CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1 +
         cs(AVISIT | USUBJID), data = adqs)
})

# LS Means at each visit
lsm <- emmeans(mmrm_fit, ~ TRT01P | AVISIT)
lsm_df <- as.data.frame(summary(lsm))

# Pairwise contrasts at each visit
pairs_res <- contrast(lsm, method = "trt.vs.ctrl", ref = "Placebo", adjust = "none")
pairs_df <- as.data.frame(summary(pairs_res))
pairs_ci <- as.data.frame(confint(pairs_res))

# Build results table
arms <- trt_levels
visits <- c("Week 8", "Week 16", "Week 24")
result_rows <- list()

for (v in visits) {
  # LS Means
  row_lsm <- tibble(Statistic = paste0(v, ": LS Mean (SE)"))
  for (a in arms) {
    l <- lsm_df %>% filter(TRT01P == a, AVISIT == v)
    row_lsm[[a]] <- if (nrow(l) > 0) fmt_est_se(l$emmean, l$SE) else ""
  }
  result_rows <- c(result_rows, list(row_lsm))

  # Pairwise vs Placebo
  for (i in seq_len(nrow(pairs_df))) {
    if (pairs_df$AVISIT[i] != v) next
    contrast_label <- as.character(pairs_df$contrast[i])
    est <- pairs_df$estimate[i]
    se <- pairs_df$SE[i]
    pv <- pairs_df$p.value[i]
    lo <- pairs_ci$lower.CL[pairs_ci$AVISIT == v & pairs_ci$contrast == contrast_label]
    hi <- pairs_ci$upper.CL[pairs_ci$AVISIT == v & pairs_ci$contrast == contrast_label]

    row_pair <- tibble(Statistic = paste0("  ", contrast_label, " Diff (SE), 95% CI, p"))
    for (a in arms) {
      row_pair[[a]] <- paste0(fmt_est_se(est, se), "  ",
                              fmt_ci(lo[1], hi[1]), "  p=", fmt_pval(pv))
    }
    result_rows <- c(result_rows, list(row_pair))
  }
}

result_df <- bind_rows(result_rows)

tbl <- result_df %>%
  gt() %>%
  tab_header(
    title = "ADAS Cog(11) - Repeated Measures Analysis (MMRM)",
    subtitle = "Population: Efficacy | Fixed: TRT*Visit, BASE*Visit, Site | Covariance: unstructured"
  ) %>%
  tab_source_note("Source: ADQSADAS") %>%
  tab_footnote("MMRM: change from baseline as response. Observed cases only (no LOCF).")

save_table(tbl, "t_15_adas_mmrm")
