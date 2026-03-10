# T-28: Weight Change from Baseline | Source: ADVS | Pop: Safety
source("00_setup.R")
cat("=== T-28: Weight Change from Baseline ===\n")

advs <- read_adam("advs") %>%
  filter(SAFFL == "Y", ANL01FL == "Y", PARAMCD == "WEIGHT") %>%
  mutate(AVAL = as.numeric(AVAL), BASE = as.numeric(BASE), CHG = as.numeric(CHG),
         AVISITN = as.numeric(AVISITN)) %>%
  trt_factor()

# Descriptive by visit
desc <- advs %>%
  filter(!is.na(CHG), AVISITN > 0) %>%
  group_by(TRT01P, AVISIT, AVISITN) %>%
  summarise(n = n(),
            mean_bl = mean(BASE, na.rm = TRUE),
            mean_val = mean(AVAL, na.rm = TRUE),
            mean_chg = mean(CHG, na.rm = TRUE),
            sd_chg = sd(CHG, na.rm = TRUE),
            .groups = "drop") %>%
  arrange(TRT01P, AVISITN)

# Format for display
desc_fmt <- desc %>%
  mutate(display = paste0(formatC(mean_chg, format = "f", digits = 2), " (",
                          formatC(sd_chg, format = "f", digits = 3), ")")) %>%
  select(AVISIT, AVISITN, TRT01P, display) %>%
  pivot_wider(names_from = TRT01P, values_from = display, values_fill = "-") %>%
  arrange(AVISITN) %>%
  select(AVISIT, all_of(trt_levels))

tbl <- desc_fmt %>%
  gt() %>%
  cols_label(AVISIT = "Visit") %>%
  tab_header(title = "Weight: Change from Baseline by Visit",
             subtitle = "Population: Safety | Mean Change (SD)") %>%
  tab_source_note("Source: ADVS (PARAMCD=WEIGHT)")

save_table(tbl, "t_28_wt_chg")
