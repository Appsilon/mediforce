# T-13: ADAS Cog(11) Females Week 24 LOCF | Source: ADQSADAS | Pop: Efficacy Females
source("00_setup.R")
cat("=== T-13: ADAS Cog(11) Females Week 24 LOCF ===\n")
adqs <- read_adam("adqsadas") %>%
  filter(EFFFL == "Y", ANL01FL == "Y", SEX == "F") %>%
  mutate(across(c(AVAL, BASE, CHG, AVISITN), as.numeric))
tbl <- run_ancova(adqs, week = 24, title_suffix = " in Female Subjects",
                  pop_label = "Efficacy - Females", dose_response = TRUE)
if (!is.null(tbl)) save_table(tbl, "t_13_adas_female")
