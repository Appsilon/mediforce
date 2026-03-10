# T-22: Lab Abnormalities (Clinically Significant) | Source: ADLB | Pop: Safety
source("00_setup.R")
cat("=== T-22: Lab Abnormalities Clinically Significant ===\n")

adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  trt_factor()

adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

# Use ANRIND for abnormalities; flag marked change from baseline
# Clinically significant = abnormal AND notable change from baseline
abn <- adlb %>%
  filter(AVISITN > 0, !is.na(ANRIND), ANRIND != "NORMAL", !is.na(CHG)) %>%
  mutate(CS_FLAG = abs(CHG) > 0) %>%
  filter(CS_FLAG) %>%
  distinct(USUBJID, TRT01P, PARAMCD, PARAM) %>%
  count(TRT01P, PARAMCD, PARAM, name = "n")

all_params <- adlb %>% distinct(PARAMCD, PARAM)

results <- all_params %>%
  crossing(TRT01P = factor(trt_levels, levels = trt_levels)) %>%
  left_join(abn, by = c("TRT01P", "PARAMCD", "PARAM")) %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(n = replace_na(n, 0),
         display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"))

wide <- results %>%
  select(PARAM, TRT01P, display) %>%
  pivot_wider(names_from = TRT01P, values_from = display) %>%
  select(PARAM, all_of(trt_levels))

tbl <- wide %>%
  gt() %>%
  tab_header(title = "Laboratory Abnormalities: Clinically Significant Changes",
             subtitle = "Population: Safety | n (%) with post-baseline abnormality and change from baseline") %>%
  tab_source_note("Source: ADLB") %>%
  tab_footnote("Clinically significant defined as post-baseline abnormal value with any change from baseline.")

save_table(tbl, "t_22_lab_abn_cs")
