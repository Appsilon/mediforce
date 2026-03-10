# T-24: Lab Shift Table Overall | Source: ADLB | Pop: Safety
source("00_setup.R")
cat("=== T-24: Lab Shift Table Overall ===\n")

adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y", !is.na(BNRIND), !is.na(ANRIND)) %>%
  trt_factor()

# Worst post-baseline shift per subject/param
shift_order <- c("LOW" = 1, "NORMAL" = 2, "HIGH" = 3)

worst <- adlb %>%
  filter(AVISITN > 0) %>%
  mutate(anr_num = shift_order[ANRIND]) %>%
  group_by(USUBJID, TRT01P, PARAMCD, PARAM, BNRIND) %>%
  summarise(worst_anrind = case_when(
    any(ANRIND == "HIGH") ~ "HIGH",
    any(ANRIND == "LOW") ~ "LOW",
    TRUE ~ "NORMAL"), .groups = "drop") %>%
  mutate(BNRIND = factor(BNRIND, levels = c("LOW", "NORMAL", "HIGH")),
         worst_anrind = factor(worst_anrind, levels = c("LOW", "NORMAL", "HIGH")))

adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

shift_counts <- worst %>%
  count(TRT01P, PARAMCD, PARAM, BNRIND, worst_anrind, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         Shift = paste0(BNRIND, " -> ", worst_anrind))

wide <- shift_counts %>%
  select(PARAM, Shift, TRT01P, display) %>%
  pivot_wider(names_from = TRT01P, values_from = display, values_fill = "0 (0.0)") %>%
  arrange(PARAM, Shift) %>%
  select(PARAM, Shift, all_of(trt_levels))

tbl <- wide %>%
  gt(groupname_col = "PARAM") %>%
  tab_header(title = "Overall Shift Table for Laboratory Parameters (Worst Post-Baseline)",
             subtitle = "Population: Safety | n (%) of subjects") %>%
  tab_source_note("Source: ADLB | Worst post-baseline vs baseline normal range indicator")

save_table(tbl, "t_24_lab_shift_overall")
