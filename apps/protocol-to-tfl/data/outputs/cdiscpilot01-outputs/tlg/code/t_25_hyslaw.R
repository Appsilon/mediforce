# T-25: Hy's Law Shift Table | Source: ADLB | Pop: Safety
source("00_setup.R")
cat("=== T-25: Hy's Law Shift Table ===\n")

adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL), BASE = as.numeric(BASE)) %>%
  trt_factor()

adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

# Get ALT/AST and Bilirubin
alt <- adlb %>% filter(PARAMCD %in% c("ALT", "AST")) %>%
  group_by(USUBJID, TRT01P) %>%
  summarise(max_alt_ratio = max(AVAL / BASE, na.rm = TRUE), .groups = "drop") %>%
  filter(is.finite(max_alt_ratio))

bili <- adlb %>% filter(PARAMCD == "BILI") %>%
  group_by(USUBJID, TRT01P) %>%
  summarise(max_bili_ratio = max(AVAL / BASE, na.rm = TRUE), .groups = "drop") %>%
  filter(is.finite(max_bili_ratio))

hys <- alt %>%
  inner_join(bili, by = c("USUBJID", "TRT01P")) %>%
  mutate(ALT_3x = max_alt_ratio >= 3,
         BILI_2x = max_bili_ratio >= 2,
         HYS_LAW = ALT_3x & BILI_2x)

# Summary by treatment
hys_summary <- hys %>%
  group_by(TRT01P) %>%
  summarise(n_eval = n(),
            n_alt3 = sum(ALT_3x),
            n_bili2 = sum(BILI_2x),
            n_hys = sum(HYS_LAW), .groups = "drop") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(`ALT/AST >= 3x BL` = paste0(n_alt3, " (", formatC(100 * n_alt3 / N, format = "f", digits = 1), ")"),
         `Bilirubin >= 2x BL` = paste0(n_bili2, " (", formatC(100 * n_bili2 / N, format = "f", digits = 1), ")"),
         `Hy's Law (both)` = paste0(n_hys, " (", formatC(100 * n_hys / N, format = "f", digits = 1), ")"),
         `Evaluable n` = as.character(n_eval))

result <- hys_summary %>%
  select(TRT01P, `Evaluable n`, `ALT/AST >= 3x BL`, `Bilirubin >= 2x BL`, `Hy's Law (both)`) %>%
  pivot_longer(-TRT01P, names_to = "Criterion", values_to = "value") %>%
  pivot_wider(names_from = TRT01P, values_from = value) %>%
  select(Criterion, all_of(trt_levels))

tbl <- result %>%
  gt() %>%
  tab_header(title = "Hy's Law Analysis: Hepatic Laboratory Shifts",
             subtitle = "Population: Safety | n (%) of subjects") %>%
  tab_source_note("Source: ADLB") %>%
  tab_footnote("ALT/AST >= 3x baseline AND Bilirubin >= 2x baseline (concurrent elevation).")

save_table(tbl, "t_25_hyslaw")
