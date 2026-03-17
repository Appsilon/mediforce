# T-27: Vital Signs Change from Baseline at EOT | Source: ADVS | Pop: Safety
source("00_setup.R")
cat("=== T-27: Vital Signs Change from Baseline at EOT ===\n")

advs <- read_adam("advs") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL), BASE = as.numeric(BASE), CHG = as.numeric(CHG)) %>%
  trt_factor()

# Last post-baseline record per subject/param
eot <- advs %>%
  filter(AVISITN > 0, !is.na(CHG)) %>%
  group_by(USUBJID, TRT01P, PARAMCD, PARAM) %>%
  filter(AVISITN == max(AVISITN)) %>%
  ungroup()

key_params <- c("SYSBP", "DIABP", "PULSE", "TEMP", "WEIGHT", "HEIGHT")

chg_desc <- eot %>%
  filter(PARAMCD %in% key_params) %>%
  group_by(TRT01P, PARAMCD, PARAM) %>%
  summarise(n = n(),
            mean_chg = mean(CHG, na.rm = TRUE),
            sd_chg = sd(CHG, na.rm = TRUE),
            median_chg = median(CHG, na.rm = TRUE),
            .groups = "drop") %>%
  mutate(display = paste0(formatC(mean_chg, format = "f", digits = 2), " (",
                          formatC(sd_chg, format = "f", digits = 3), ")"))

wide <- chg_desc %>%
  select(PARAM, TRT01P, display) %>%
  pivot_wider(names_from = TRT01P, values_from = display, values_fill = "-") %>%
  select(PARAM, all_of(trt_levels))

tbl <- wide %>%
  gt() %>%
  tab_header(title = "Vital Signs: Change from Baseline at End of Treatment",
             subtitle = "Population: Safety | Mean Change (SD)") %>%
  tab_source_note("Source: ADVS | Last post-baseline observation")

save_table(tbl, "t_27_vs_chg")
