# T-20: Lab Summary Statistics | Source: ADLB | Pop: Safety
source("00_setup.R")
cat("=== T-20: Lab Summary Statistics ===\n")

adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL), AVISITN = as.numeric(AVISITN)) %>%
  trt_factor()

# Select key lab parameters (top 10 by frequency)
top_params <- adlb %>%
  count(PARAMCD, PARAM, PARCAT1, sort = TRUE) %>%
  head(15)

adlb_subset <- adlb %>%
  filter(PARAMCD %in% top_params$PARAMCD) %>%
  mutate(AVISIT = factor(AVISIT, levels = c("Baseline", paste("Week", c(2,4,6,8,12,16,20,24,26)))))

tbl <- adlb_subset %>%
  tbl_strata(strata = PARAMCD,
    .tbl_fun = ~ .x %>%
      tbl_summary(by = TRT01P, include = AVAL,
        statistic = all_continuous() ~ "{mean} ({sd})",
        digits = all_continuous() ~ c(2, 3), missing = "no") %>%
      modify_header(label ~ ""),
    .header = "**{strata}**") %>%
  modify_caption("**Table T-20: Summary Statistics for Continuous Laboratory Values**<br>Population: Safety")

save_table(tbl, "t_20_lab_summ")
