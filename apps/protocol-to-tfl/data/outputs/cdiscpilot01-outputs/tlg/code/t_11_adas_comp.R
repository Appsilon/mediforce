# T-11: ADAS Cog(11) Completers Week 24 OC | Source: ADQSADAS | Pop: Efficacy Completers
source("00_setup.R")
cat("=== T-11: ADAS Cog(11) Completers Week 24 Observed Cases ===\n")
adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL02FL == "Y") %>%  # Observed cases only
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))
# Use observed-case completers; small N expected
d <- adqs %>%
  filter(AVISITN == 24, !is.na(CHG), !is.na(BASE)) %>%
  mutate(TRT01P = factor(TRT01P, levels = trt_levels),
         SITEGR1 = factor(SITEGR1))

if (nrow(d) >= 5) {
  desc <- d %>%
    group_by(TRT01P) %>%
    summarise(n = n(), mean_bl = mean(BASE), sd_bl = sd(BASE),
              mean_chg = mean(CHG), sd_chg = sd(CHG), .groups = "drop")

  # Simplified ANCOVA (drop SITEGR1 if too few obs per site)
  mod <- tryCatch(lm(CHG ~ BASE + TRT01P + SITEGR1, data = d),
                  error = function(e) lm(CHG ~ BASE + TRT01P, data = d))
  lsm <- emmeans(mod, ~ TRT01P)
  lsm_df <- as.data.frame(summary(lsm))

  arms <- trt_levels
  rows <- list()
  for (a in arms) {
    dd <- desc %>% filter(TRT01P == a)
    ll <- lsm_df %>% filter(TRT01P == a)
    if (nrow(dd) == 0) { rows[[a]] <- rep("-", 4); next }
    rows[[a]] <- c(
      formatC(dd$n, format = "d"),
      paste0(formatC(dd$mean_bl, format = "f", digits = 2), " (", formatC(dd$sd_bl, format = "f", digits = 3), ")"),
      paste0(formatC(dd$mean_chg, format = "f", digits = 2), " (", formatC(dd$sd_chg, format = "f", digits = 3), ")"),
      formatC(ll$emmean, format = "f", digits = 2)
    )
  }

  result_df <- tibble(Statistic = c("n", "Baseline Mean (SD)", "Change from BL Mean (SD)", "LS Mean"))
  for (a in arms) result_df[[a]] <- rows[[a]]

  tbl <- result_df %>%
    gt() %>%
    tab_header(title = "ADAS Cog(11) - Change from Baseline to Week 24 (Completers - Observed Cases)",
               subtitle = "Population: Efficacy Completers | ANCOVA: baseline, treatment") %>%
    tab_source_note("Source: ADQSADAS (ANL02FL='Y')") %>%
    tab_footnote("Small sample; pooled site may be excluded from model if insufficient observations.")

  save_table(tbl, "t_11_adas_comp")
} else {
  cat("  Skipped: too few completers (n=", nrow(d), ")\n")
}
