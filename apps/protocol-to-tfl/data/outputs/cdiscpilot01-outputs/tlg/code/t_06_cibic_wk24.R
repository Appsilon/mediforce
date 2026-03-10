# T-6: CIBIC+ at Week 24 LOCF (Primary) | Source: ADQSCIBC | Pop: Efficacy
source("00_setup.R")
cat("=== T-6: Primary Endpoint CIBIC+ Week 24 LOCF ===\n")

adqs <- read_adam("adqscibc") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, AVISITN), as.numeric))

tbl <- run_cibic_anova(adqs, week = 24)
if (!is.null(tbl)) save_table(tbl, "t_06_cibic_wk24")
