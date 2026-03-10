# T-8: CIBIC+ at Week 8 LOCF | Source: ADQSCIBC | Pop: Efficacy
source("00_setup.R")
cat("=== T-8: CIBIC+ Week 8 LOCF ===\n")

adqs <- read_adam("adqscibc") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, AVISITN), as.numeric))

tbl <- run_cibic_anova(adqs, week = 8)
if (!is.null(tbl)) save_table(tbl, "t_08_cibic_wk8")
