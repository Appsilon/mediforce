# T-17: Exposure Summary | Source: ADEX | Pop: Safety
source("00_setup.R")
cat("=== T-17: Exposure Summary ===\n")

adex <- read_adam("adex") %>%
  filter(SAFFL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL),
         PARAM = factor(PARAM, levels = c(
           "Average Daily Dose (mg)", "Cumulative Dose (mg)", "Duration of Treatment (days)"))) %>%
  trt_factor()

tbl <- adex %>%
  tbl_strata(strata = PARAM,
    .tbl_fun = ~ .x %>%
      tbl_summary(by = TRT01P, include = AVAL,
        statistic = all_continuous() ~ "{mean} ({sd}); {median}; {min}, {max}",
        digits = all_continuous() ~ 1, missing = "no") %>%
      modify_header(label ~ ""),
    .header = "**{strata}**") %>%
  modify_caption("**Table T-17: Summary of Planned Exposure to Study Drug**<br>Population: Safety")

save_table(tbl, "t_17_expo")
