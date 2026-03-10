# T-12: ADAS Cog(11) Males Week 24 LOCF | Source: ADQSADAS | Pop: Efficacy Males
source("00_setup.R")
cat("=== T-12: ADAS Cog(11) Males Week 24 LOCF ===\n")
adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL01FL == "Y", SEX == "M") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))
tbl <- run_ancova(adqs, week = 24, title_suffix = " in Male Subjects",
                  pop_label = "Efficacy - Males", dose_response = TRUE)
if (!is.null(tbl)) save_table(tbl, "t_12_adas_male")
