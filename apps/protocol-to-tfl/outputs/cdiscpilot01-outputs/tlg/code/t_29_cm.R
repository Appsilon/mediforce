# T-29: Concomitant Medications | Source: ADCM | Pop: Safety
source("00_setup.R")
cat("=== T-29: Concomitant Medications ===\n")

adcm <- read_adam("adcm") %>%
  filter(SAFFL == "Y", ONTRTFL == "Y") %>%
  trt_factor()

adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

# Any concomitant medication
any_cm <- adcm %>%
  distinct(USUBJID, TRT01P) %>%
  count(TRT01P, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         CMCLAS = "Any Concomitant Medication", CMDECOD = "", sort_order = 0)

# By ATC class
class_counts <- adcm %>%
  distinct(USUBJID, TRT01P, CMCLAS) %>%
  count(TRT01P, CMCLAS, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         CMDECOD = "", sort_order = 1)

# By preferred name within class
med_counts <- adcm %>%
  distinct(USUBJID, TRT01P, CMCLAS, CMDECOD) %>%
  count(TRT01P, CMCLAS, CMDECOD, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         sort_order = 2)

all_counts <- bind_rows(any_cm, class_counts, med_counts) %>%
  select(TRT01P, CMCLAS, CMDECOD, display, sort_order)

wide <- all_counts %>%
  pivot_wider(names_from = TRT01P, values_from = display, values_fill = "0 (0.0)") %>%
  arrange(sort_order, CMCLAS, desc(CMDECOD == ""), CMDECOD) %>%
  mutate(Term = if_else(CMDECOD == "", CMCLAS, paste0("  ", CMDECOD))) %>%
  select(Term, all_of(trt_levels))

tbl <- wide %>%
  gt() %>%
  tab_header(title = "Concomitant Medications by ATC Class and Preferred Name",
             subtitle = "Population: Safety | n (%) of subjects with at least one occurrence") %>%
  tab_source_note("Source: ADCM | On-treatment concomitant medications only")

save_table(tbl, "t_29_cm")
