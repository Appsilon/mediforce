# T-5: ADAS Cog(11) CFB to Week 24 LOCF (Primary) | Source: ADQSADAS | Pop: Efficacy
source("00_setup.R")
cat("=== T-5: Primary Endpoint ADAS Cog(11) Week 24 LOCF ===\n")

adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))

tbl <- run_ancova(adqs, week = 24)
if (!is.null(tbl)) save_table(tbl, "t_05_adas_wk24")
