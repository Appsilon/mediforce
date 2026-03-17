# T-14: ADAS Cog(11) Mean and Change over Time | Source: ADQSADAS | Pop: Efficacy
source("00_setup.R")
cat("=== T-14: ADAS Cog(11) Mean over Time ===\n")

adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric),
         AVISIT = factor(AVISIT, levels = c("Baseline", "Week 8", "Week 16", "Week 24"))) %>%
  trt_factor()

tbl <- adqs %>%
  tbl_strata(
    strata = AVISIT,
    .tbl_fun = ~ .x %>%
      tbl_summary(by = TRT01P, include = c(AVAL, CHG),
        label = list(AVAL ~ "Score", CHG ~ "Change from Baseline"),
        statistic = all_continuous() ~ "{n}; {mean} ({sd})",
        digits = all_continuous() ~ c(0, 2, 3), missing = "no"),
    .header = "**{strata}**"
  ) %>%
  modify_caption("**Table T-14: ADAS Cog(11) - Mean and Mean Change from Baseline over Time**<br>Population: Efficacy | LOCF")

save_table(tbl, "t_14_adas_time")
