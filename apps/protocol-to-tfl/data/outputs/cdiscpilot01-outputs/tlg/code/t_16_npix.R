# T-16: NPI-X Total Mean Wk4-24 | Source: ADQSNPIX | Pop: Efficacy
source("00_setup.R")
cat("=== T-16: NPI-X Mean Score Week 4-24 ===\n")

adqs <- read_adam("adqsnpix") %>%
  filter(EFFFL == "Y") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))

# Use the NPTOTMN (mean) parameter for the ANCOVA
mean_data <- adqs %>%
  filter(PARAMCD == "NPTOTMN", !is.na(CHG), !is.na(BASE)) %>%
  mutate(TRT01P = factor(TRT01P, levels = trt_levels),
         SITEGR1 = factor(SITEGR1))

# Descriptive for baseline
bl_data <- adqs %>% filter(PARAMCD == "NPTOT", AVISITN == 0)
bl_desc <- bl_data %>%
  mutate(TRT01P = factor(TRT01P, levels = trt_levels)) %>%
  group_by(TRT01P) %>%
  summarise(n = n(), mean = mean(AVAL), sd = sd(AVAL), .groups = "drop")

# Descriptive for mean endpoint
mn_desc <- mean_data %>%
  group_by(TRT01P) %>%
  summarise(n = n(), mean = mean(AVAL), sd = sd(AVAL), .groups = "drop")

# ANCOVA
mod <- lm(CHG ~ BASE + TRT01P + SITEGR1, data = mean_data)
lsm <- emmeans(mod, ~ TRT01P)
lsm_df <- as.data.frame(summary(lsm))
pairs_res <- contrast(lsm, method = "pairwise", adjust = "none")
pairs_df <- as.data.frame(summary(pairs_res))

# Dose-response
mean_data2 <- mean_data %>%
  mutate(TRT_DOSE = case_when(
    TRT01P == "Placebo" ~ 0, TRT01P == "Xanomeline Low Dose" ~ 54,
    TRT01P == "Xanomeline High Dose" ~ 81))
dose_mod <- lm(CHG ~ BASE + TRT_DOSE + SITEGR1, data = mean_data2)
dose_p <- summary(dose_mod)$coefficients["TRT_DOSE", "Pr(>|t|)"]

# Build table
arms <- trt_levels
rows <- list()
for (a in arms) {
  bd <- bl_desc %>% filter(TRT01P == a)
  md <- mn_desc %>% filter(TRT01P == a)
  ll <- lsm_df %>% filter(TRT01P == a)
  rows[[a]] <- c(
    formatC(bd$n, format = "d"),
    paste0(formatC(bd$mean, format = "f", digits = 2), " (", formatC(bd$sd, format = "f", digits = 3), ")"),
    formatC(md$n, format = "d"),
    paste0(formatC(md$mean, format = "f", digits = 2), " (", formatC(md$sd, format = "f", digits = 3), ")"),
    formatC(ll$emmean, format = "f", digits = 2),
    fmt_est_se(ll$emmean, ll$SE)
  )
}

result_df <- tibble(Statistic = c("Baseline n", "Baseline Mean (SD)",
  "Mean NPI-X (Wk 4-24) n", "Mean NPI-X (Wk 4-24) Mean (SD)",
  "LS Mean", "LS Mean (SE)"))
for (a in arms) result_df[[a]] <- rows[[a]]

# Dose-response row
dr <- tibble(Statistic = "Dose-response p-value")
for (a in arms) dr[[a]] <- if (a == tail(arms, 1)) fmt_pval(dose_p) else ""
result_df <- bind_rows(result_df, dr)

# Pairwise
for (i in seq_len(nrow(pairs_df))) {
  pw <- tibble(Statistic = paste0(pairs_df$contrast[i], ": Diff (SE), p"))
  for (a in arms) pw[[a]] <- paste0(fmt_est_se(pairs_df$estimate[i], pairs_df$SE[i]),
                                     "  p=", fmt_pval(pairs_df$p.value[i]))
  result_df <- bind_rows(result_df, pw)
}

tbl <- result_df %>%
  gt() %>%
  tab_header(title = "Mean NPI-X Total Score from Week 4 through Week 24",
             subtitle = "Population: Efficacy | ANCOVA: baseline, pooled site, treatment") %>%
  tab_source_note("Source: ADQSNPIX") %>%
  tab_footnote("Endpoint = mean of all available NPI-X(9) total scores Wk 4-24.")

save_table(tbl, "t_16_npix")
