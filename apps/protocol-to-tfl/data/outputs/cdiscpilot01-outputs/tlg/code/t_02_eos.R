# T-2: Summary of End of Study Data | Source: ADSL | Population: ITT
source("00_setup.R")
cat("=== T-2: Summary of End of Study Data ===\n")

adsl <- read_adam("adsl") %>%
  filter(ITTFL == "Y") %>%
  trt_factor() %>%
  mutate(
    EOSSTT = factor(EOSSTT, levels = c("COMPLETED", "DISCONTINUED")),
    DCSREAS = if_else(is.na(DCSREAS) | DCSREAS == "", "Not Applicable", DCSREAS)
  )

tbl <- adsl %>%
  tbl_summary(by = TRT01P, include = c(EOSSTT, DCSREAS),
    label = list(EOSSTT ~ "Completion Status", DCSREAS ~ "Reason for Discontinuation"),
    statistic = all_categorical() ~ "{n} ({p}%)", missing = "no") %>%
  add_overall() %>%
  add_p(test = all_categorical() ~ "fisher.test") %>%
  modify_caption("**Table T-2: Summary of End of Study Data**<br>Protocol: CDISCPILOT01 | Population: Intent-to-Treat")

save_table(tbl, "t_02_eos")
