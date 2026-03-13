# T-1: Summary of Populations | Source: ADSL | Population: All Subjects
source("00_setup.R")
cat("=== T-1: Summary of Populations ===\n")

adsl <- read_adam("adsl") %>%
  filter(TRT01P %in% trt_levels) %>%
  trt_factor()

pop_long <- adsl %>%
  mutate(across(c(ITTFL, SAFFL, EFFFL, COMP8FL, COMP16FL, COMP24FL),
                ~ .x == "Y")) %>%
  pivot_longer(c(ITTFL, SAFFL, EFFFL, COMP8FL, COMP16FL, COMP24FL),
               names_to = "Population", values_to = "Flag") %>%
  filter(Flag) %>%
  mutate(Population = recode(Population,
    ITTFL = "Intent-to-Treat (ITT)", SAFFL = "Safety",
    EFFFL = "Efficacy", COMP8FL = "Completers Week 8",
    COMP16FL = "Completers Week 16", COMP24FL = "Completers Week 24"
  ))

tbl <- pop_long %>%
  tbl_summary(by = TRT01P, include = Population,
              statistic = all_categorical() ~ "{n} ({p}%)") %>%
  add_overall() %>%
  modify_header(label ~ "**Population**") %>%
  modify_caption("**Table T-1: Summary of Populations**<br>Protocol: CDISCPILOT01 | Population: All Subjects")

save_table(tbl, "t_01_pop")
