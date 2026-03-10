# T-7: ADAS Cog(11) CFB to Week 8 LOCF | Source: ADQSADAS | Pop: Efficacy
source("00_setup.R")
cat("=== T-7: ADAS Cog(11) Week 8 LOCF ===\n")

adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))

tbl <- run_ancova(adqs, week = 8)
if (!is.null(tbl)) save_table(tbl, "t_07_adas_wk8")
