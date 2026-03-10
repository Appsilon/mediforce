# T-21: Lab Abnormalities (Beyond Normal Range) | Source: ADLB | Pop: Safety
source("00_setup.R")
cat("=== T-21: Lab Abnormalities Beyond Normal Range ===\n")

adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y", !is.na(ANRIND)) %>%
  trt_factor()

adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

# Flag post-baseline abnormal values
abn <- adlb %>%
  filter(AVISITN > 0) %>%
  mutate(ABN_LOW = ANRIND == "LOW", ABN_HIGH = ANRIND == "HIGH") %>%
  group_by(USUBJID, TRT01P, PARAMCD, PARAM) %>%
  summarise(any_low = any(ABN_LOW, na.rm = TRUE),
            any_high = any(ABN_HIGH, na.rm = TRUE), .groups = "drop")

# Count subjects with any post-BL abnormality per param
low_counts <- abn %>% filter(any_low) %>%
  count(TRT01P, PARAMCD, PARAM, name = "n_low")
high_counts <- abn %>% filter(any_high) %>%
  count(TRT01P, PARAMCD, PARAM, name = "n_high")

all_params <- abn %>% distinct(PARAMCD, PARAM)

results <- all_params %>%
  crossing(TRT01P = factor(trt_levels, levels = trt_levels)) %>%
  left_join(low_counts, by = c("TRT01P", "PARAMCD", "PARAM")) %>%
  left_join(high_counts, by = c("TRT01P", "PARAMCD", "PARAM")) %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(n_low = replace_na(n_low, 0), n_high = replace_na(n_high, 0),
         Low = paste0(n_low, " (", formatC(100 * n_low / N, format = "f", digits = 1), ")"),
         High = paste0(n_high, " (", formatC(100 * n_high / N, format = "f", digits = 1), ")"))

wide_low <- results %>%
  select(PARAM, TRT01P, Low) %>%
  pivot_wider(names_from = TRT01P, values_from = Low) %>%
  mutate(Direction = "Low") %>%
  select(PARAM, Direction, all_of(trt_levels))

wide_high <- results %>%
  select(PARAM, TRT01P, High) %>%
  pivot_wider(names_from = TRT01P, values_from = High) %>%
  mutate(Direction = "High") %>%
  select(PARAM, Direction, all_of(trt_levels))

wide <- bind_rows(wide_low, wide_high) %>% arrange(PARAM, Direction)

tbl <- wide %>%
  gt(groupname_col = "PARAM") %>%
  tab_header(title = "Laboratory Abnormalities: Values Beyond Normal Range",
             subtitle = "Population: Safety | n (%) with any post-baseline abnormality") %>%
  tab_source_note("Source: ADLB")

save_table(tbl, "t_21_lab_abn")
