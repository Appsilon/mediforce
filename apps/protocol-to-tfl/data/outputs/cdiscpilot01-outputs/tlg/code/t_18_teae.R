# T-18: TEAE by SOC/PT | Source: ADAE | Pop: Safety
source("00_setup.R")
cat("=== T-18: Incidence of TEAEs ===\n")

adae <- read_adam("adae") %>%
  filter(SAFFL == "Y", TRTEMFL == "Y") %>%
  trt_factor()

# Denominator: safety population N per arm
adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

# Any TEAE row
any_ae <- adae %>%
  distinct(USUBJID, TRT01P) %>%
  count(TRT01P, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         AEBODSYS = "Any TEAE", AEDECOD = "", sort_order = 0)

# By SOC
soc_counts <- adae %>%
  filter(AOCCSFL == "Y") %>%
  count(TRT01P, AEBODSYS, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         AEDECOD = "", sort_order = 1)

# By SOC/PT
pt_counts <- adae %>%
  filter(AOCCPFL == "Y") %>%
  count(TRT01P, AEBODSYS, AEDECOD, name = "n") %>%
  left_join(denoms, by = "TRT01P") %>%
  mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"),
         sort_order = 2)

# Combine and pivot
all_counts <- bind_rows(any_ae, soc_counts, pt_counts) %>%
  select(TRT01P, AEBODSYS, AEDECOD, display, sort_order)

# Pivot wide by treatment
wide <- all_counts %>%
  pivot_wider(names_from = TRT01P, values_from = display, values_fill = "0 (0.0)") %>%
  arrange(sort_order, AEBODSYS, desc(AEDECOD == ""), AEDECOD) %>%
  mutate(Term = if_else(AEDECOD == "", AEBODSYS, paste0("  ", AEDECOD))) %>%
  select(Term, all_of(trt_levels))

tbl <- wide %>%
  gt() %>%
  tab_header(
    title = "Incidence of Treatment Emergent Adverse Events by Treatment Group",
    subtitle = "Population: Safety | n (%) of subjects with at least one occurrence"
  ) %>%
  tab_source_note("Source: ADAE | TEAEs: start date >= first dose. MedDRA coded. SOC alphabetical, PT by descending frequency.")

save_table(tbl, "t_18_teae")
