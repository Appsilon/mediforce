# T-10: CIBIC+ at Week 16 LOCF | Source: ADQSCIBC | Pop: Efficacy
source("00_setup.R")
cat("=== T-10: CIBIC+ Week 16 LOCF ===\n")
adqs <- read_adam("adqscibc") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, AVISITN), as.numeric))
tbl <- run_cibic_anova(adqs, week = 16)
if (!is.null(tbl)) save_table(tbl, "t_10_cibic_wk16")
