# ============================================================
# 00_setup.R — Shared configuration and helpers for TLG generation
# Study: CDISCPILOT01 — Xanomeline (TTS) in Alzheimer's Disease
# ============================================================

.libPaths(c(
  "/Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/dev_libraries",
  .libPaths()
))

suppressPackageStartupMessages({
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
})

# ---- Paths ----
adam_dir   <- "/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/data"
output_dir <- "/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/tlg/outputs"

# ---- Read ADaM ----
read_adam <- function(name) {
  csv_path  <- file.path(adam_dir, paste0(tolower(name), ".csv"))
  json_path <- file.path(adam_dir, paste0(tolower(name), ".json"))
  if (file.exists(csv_path)) {
    df <- read.csv(csv_path, stringsAsFactors = FALSE)
  } else if (file.exists(json_path)) {
    df <- jsonlite::fromJSON(json_path)
  } else {
    stop(paste("ADaM dataset", name, "not found"))
  }
  names(df) <- toupper(names(df))
  df %>% mutate(across(where(is.character), ~ trimws(.x)))
}

# ---- Treatment arm ordering ----
trt_levels <- c("Placebo", "Xanomeline Low Dose", "Xanomeline High Dose")

trt_factor <- function(data, var = "TRT01P") {
  data %>% mutate(!!var := factor(.data[[var]], levels = trt_levels))
}

trt_n_labels <- function(data, var = "TRT01P") {
  lvls <- trt_levels
  lbls <- sapply(lvls, function(a) {
    n <- sum(data[[var]] == a, na.rm = TRUE)
    paste0(a, "\n(N=", n, ")")
  })
  data %>% mutate(!!var := factor(.data[[var]], levels = lvls, labels = lbls))
}

# ---- gtsummary theme ----
theme_gtsummary_compact()

# ---- ggplot2 theme ----
study_theme <- function() {
  theme_bw(base_size = 11) +
    theme(
      plot.title = element_text(size = 12, face = "bold", hjust = 0),
      plot.subtitle = element_text(size = 10, hjust = 0),
      plot.caption = element_text(size = 8, hjust = 0),
      legend.position = "bottom",
      legend.title = element_blank(),
      panel.grid.minor = element_blank()
    )
}

# ---- Format helpers ----
fmt_pval <- function(p) {
  dplyr::case_when(
    is.na(p) ~ "",
    p < 0.0001 ~ "<0.0001",
    TRUE ~ formatC(p, format = "f", digits = 4)
  )
}

fmt_ci <- function(lo, hi, d = 2) {
  paste0("(", formatC(lo, format = "f", digits = d),
         ", ", formatC(hi, format = "f", digits = d), ")")
}

fmt_est_se <- function(est, se, d_est = 2, d_se = 3) {
  paste0(formatC(est, format = "f", digits = d_est),
         " (", formatC(se, format = "f", digits = d_se), ")")
}

# ---- Save helpers ----
save_table <- function(tbl, filename) {
  path <- file.path(output_dir, "tables", paste0(filename, ".html"))
  tryCatch({
    gt_obj <- if (inherits(tbl, "gt_tbl")) tbl else as_gt(tbl)
    gt::gtsave(gt_obj, path)
    cat("  Saved:", path, "\n")
  }, error = function(e) {
    cat("  gt save failed, trying HTML print:", e$message, "\n")
    html <- as.character(as_gt(tbl) %>% gt::as_raw_html())
    writeLines(html, path)
    cat("  Saved via raw HTML:", path, "\n")
  })
}

save_figure <- function(p, filename, w = 10, h = 7, dpi = 300) {
  path <- file.path(output_dir, "figures", paste0(filename, ".png"))
  ggsave(path, plot = p, width = w, height = h, dpi = dpi)
  cat("  Saved:", path, "\n")
}

# ============================================================
# Reusable analysis functions
# ============================================================

# ---- ANCOVA with emmeans (for ADAS-Cog T-5/T-7/T-9/T-11/T-12/T-13) ----
run_ancova <- function(data, week, title_suffix = "", pop_label = "Efficacy",
                       dose_response = TRUE) {
  d <- data %>%
    filter(AVISITN == week, !is.na(CHG), !is.na(BASE)) %>%
    mutate(TRT01P = factor(TRT01P, levels = trt_levels),
           SITEGR1 = factor(SITEGR1))

  if (nrow(d) < 10) return(NULL)

  # Descriptive stats
  desc <- d %>%
    group_by(TRT01P) %>%
    summarise(
      n_bl = sum(!is.na(BASE)), mean_bl = mean(BASE), sd_bl = sd(BASE),
      n_post = sum(!is.na(AVAL)), mean_post = mean(AVAL), sd_post = sd(AVAL),
      n_chg = sum(!is.na(CHG)), mean_chg = mean(CHG), sd_chg = sd(CHG),
      .groups = "drop"
    )

  # ANCOVA
  mod <- lm(CHG ~ BASE + TRT01P + SITEGR1, data = d)
  lsm <- emmeans(mod, ~ TRT01P)
  lsm_df <- as.data.frame(summary(lsm))
  pairs_res <- contrast(lsm, method = "pairwise", adjust = "none")
  pairs_df <- as.data.frame(summary(pairs_res))
  pairs_ci <- as.data.frame(confint(pairs_res))

  # Dose-response p-value
  dose_p <- NA
  if (dose_response) {
    d2 <- d %>% mutate(TRT_DOSE = case_when(
      TRT01P == "Placebo" ~ 0,
      TRT01P == "Xanomeline Low Dose" ~ 54,
      TRT01P == "Xanomeline High Dose" ~ 81
    ))
    dose_mod <- lm(CHG ~ BASE + TRT_DOSE + SITEGR1, data = d2)
    dose_p <- summary(dose_mod)$coefficients["TRT_DOSE", "Pr(>|t|)"]
  }

  # Build results table
  arms <- trt_levels
  rows <- list()
  for (a in arms) {
    dd <- desc %>% filter(TRT01P == a)
    ll <- lsm_df %>% filter(TRT01P == a)
    rows[[a]] <- c(
      formatC(dd$n_bl, format = "d"),
      paste0(formatC(dd$mean_bl, format = "f", digits = 2), " (",
             formatC(dd$sd_bl, format = "f", digits = 3), ")"),
      formatC(dd$n_post, format = "d"),
      paste0(formatC(dd$mean_post, format = "f", digits = 2), " (",
             formatC(dd$sd_post, format = "f", digits = 3), ")"),
      formatC(dd$n_chg, format = "d"),
      paste0(formatC(dd$mean_chg, format = "f", digits = 2), " (",
             formatC(dd$sd_chg, format = "f", digits = 3), ")"),
      formatC(ll$emmean, format = "f", digits = 2),
      fmt_est_se(ll$emmean, ll$SE)
    )
  }

  stat_labels <- c("Baseline n", "Baseline Mean (SD)",
                    paste0("Week ", week, " n"),
                    paste0("Week ", week, " Mean (SD)"),
                    "Change from Baseline n", "Change from Baseline Mean (SD)",
                    "LS Mean", "LS Mean (SE)")

  result_df <- tibble(Statistic = stat_labels)
  for (a in arms) result_df[[a]] <- rows[[a]]

  # Add dose-response row
  if (dose_response) {
    dr_row <- tibble(Statistic = "Dose-response test p-value")
    for (a in arms) dr_row[[a]] <- if (a == tail(arms, 1)) fmt_pval(dose_p) else ""
    result_df <- bind_rows(result_df, dr_row)
  }

  # Add pairwise comparison rows
  for (i in seq_len(nrow(pairs_df))) {
    contrast_name <- pairs_df$contrast[i]
    est <- pairs_df$estimate[i]
    se <- pairs_df$SE[i]
    pv <- pairs_df$p.value[i]
    lo <- pairs_ci$lower.CL[i]
    hi <- pairs_ci$upper.CL[i]

    pw_rows <- tibble(Statistic = c(
      paste0(contrast_name, ": Diff (SE)"),
      paste0(contrast_name, ": 95% CI"),
      paste0(contrast_name, ": p-value")
    ))
    # Place values in appropriate column
    for (a in arms) {
      pw_rows[[a]] <- c(fmt_est_se(est, se), fmt_ci(lo, hi), fmt_pval(pv))
    }
    result_df <- bind_rows(result_df, pw_rows)
  }

  # Render as gt
  week_label <- paste("Week", week)
  tbl <- result_df %>%
    gt() %>%
    tab_header(
      title = paste0("ADAS Cog(11) - Change from Baseline to ", week_label,
                     " - LOCF", title_suffix),
      subtitle = paste0("Population: ", pop_label,
                        " | ANCOVA: baseline, pooled site, treatment")
    ) %>%
    tab_source_note("Source: ADQSADAS") %>%
    tab_footnote("ANCOVA model with baseline ADAS-Cog(11), pooled site, treatment.")

  tbl
}

# ---- ANOVA for CIBIC+ (T-6/T-8/T-10) ----
run_cibic_anova <- function(data, week) {
  d <- data %>%
    filter(AVISITN == week, !is.na(AVAL)) %>%
    mutate(AVAL = as.numeric(AVAL),
           TRT01P = factor(TRT01P, levels = trt_levels),
           SITEGR1 = factor(SITEGR1))

  if (nrow(d) < 10) return(NULL)

  # Descriptive
  desc <- d %>%
    group_by(TRT01P) %>%
    summarise(n = n(), mean = mean(AVAL), sd = sd(AVAL),
              median = median(AVAL),
              min = min(AVAL), max = max(AVAL), .groups = "drop")

  # Frequency distribution
  freq <- d %>%
    mutate(AVAL_CAT = factor(AVAL, levels = 1:7, labels = c(
      "1 = Marked improvement", "2 = Moderate improvement",
      "3 = Minimal improvement", "4 = No change",
      "5 = Minimal worsening", "6 = Moderate worsening",
      "7 = Marked worsening"))) %>%
    count(TRT01P, AVAL_CAT, .drop = FALSE) %>%
    group_by(TRT01P) %>%
    mutate(pct = round(100 * n / sum(n), 1),
           display = paste0(n, " (", formatC(pct, format = "f", digits = 1), ")")) %>%
    ungroup()

  # ANOVA (no baseline covariate)
  mod <- lm(AVAL ~ TRT01P + SITEGR1, data = d)
  lsm <- emmeans(mod, ~ TRT01P)
  lsm_df <- as.data.frame(summary(lsm))
  pairs_res <- contrast(lsm, method = "pairwise", adjust = "none")
  pairs_df <- as.data.frame(summary(pairs_res))

  # Dose-response
  d2 <- d %>% mutate(TRT_DOSE = case_when(
    TRT01P == "Placebo" ~ 0,
    TRT01P == "Xanomeline Low Dose" ~ 54,
    TRT01P == "Xanomeline High Dose" ~ 81
  ))
  dose_mod <- lm(AVAL ~ TRT_DOSE + SITEGR1, data = d2)
  dose_p <- summary(dose_mod)$coefficients["TRT_DOSE", "Pr(>|t|)"]

  # Build summary rows
  arms <- trt_levels
  rows <- list()
  for (a in arms) {
    dd <- desc %>% filter(TRT01P == a)
    ll <- lsm_df %>% filter(TRT01P == a)
    rows[[a]] <- c(
      formatC(dd$n, format = "d"),
      paste0(formatC(dd$mean, format = "f", digits = 2), " (",
             formatC(dd$sd, format = "f", digits = 3), ")"),
      formatC(dd$median, format = "f", digits = 2),
      paste0(formatC(dd$min, format = "f", digits = 0), ", ",
             formatC(dd$max, format = "f", digits = 0)),
      formatC(ll$emmean, format = "f", digits = 2),
      fmt_est_se(ll$emmean, ll$SE)
    )
  }
  stat_labels <- c("n", "Mean (SD)", "Median", "Min, Max", "LS Mean", "LS Mean (SE)")
  result_df <- tibble(Statistic = stat_labels)
  for (a in arms) result_df[[a]] <- rows[[a]]

  # Dose-response
  dr_row <- tibble(Statistic = "Dose-response p-value")
  for (a in arms) dr_row[[a]] <- if (a == tail(arms, 1)) fmt_pval(dose_p) else ""
  result_df <- bind_rows(result_df, dr_row)

  # Pairwise
  for (i in seq_len(nrow(pairs_df))) {
    pw_row <- tibble(Statistic = paste0(pairs_df$contrast[i], ": Diff (SE), p-value"))
    for (a in arms) {
      pw_row[[a]] <- paste0(fmt_est_se(pairs_df$estimate[i], pairs_df$SE[i]),
                            "  p=", fmt_pval(pairs_df$p.value[i]))
    }
    result_df <- bind_rows(result_df, pw_row)
  }

  # Add frequency rows
  freq_rows <- tibble(Statistic = paste0("  ", levels(freq$AVAL_CAT)))
  for (a in arms) {
    af <- freq %>% filter(TRT01P == a)
    freq_rows[[a]] <- af$display
  }
  # Insert frequency block after descriptive
  result_df <- bind_rows(
    result_df[1:4, ],
    tibble(Statistic = "Frequency distribution, n (%)") %>%
      {for (a in arms) .[[a]] <- ""; .},
    freq_rows,
    result_df[5:nrow(result_df), ]
  )

  result_df %>%
    gt() %>%
    tab_header(
      title = paste0("CIBIC+ - Summary at Week ", week, " - LOCF"),
      subtitle = "Population: Efficacy | ANOVA: pooled site, treatment"
    ) %>%
    tab_source_note("Source: ADQSCIBC") %>%
    tab_footnote("ANOVA model with pooled site and treatment. No baseline covariate (CIBIC+ is a change measure).")
}

cat("Setup complete.\n")
