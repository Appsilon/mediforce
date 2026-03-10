# T-9: ADAS Cog(11) CFB to Week 16 LOCF | Source: ADQSADAS | Pop: Efficacy
source("00_setup.R")
cat("=== T-9: ADAS Cog(11) Week 16 LOCF ===\n")
adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL01FL == "Y") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))
tbl <- run_ancova(adqs, week = 16)
if (!is.null(tbl)) save_table(tbl, "t_09_adas_wk16")
