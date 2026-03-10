# T-4: Summary of Subjects by Site | Source: ADSL | Population: Safety
source("00_setup.R")
cat("=== T-4: Summary of Number of Subjects by Site ===\n")

adsl <- read_adam("adsl") %>%
  filter(SAFFL == "Y") %>%
  trt_factor() %>%
  mutate(SITEGR1 = paste("Site", SITEGR1))

tbl <- adsl %>%
  tbl_summary(by = TRT01P, include = SITEGR1,
    label = list(SITEGR1 ~ "Pooled Site"),
    statistic = all_categorical() ~ "{n}", missing = "no") %>%
  add_overall() %>%
  modify_caption("**Table T-4: Summary of Number of Subjects by Site**<br>Protocol: CDISCPILOT01 | Population: Safety")

save_table(tbl, "t_04_site")
