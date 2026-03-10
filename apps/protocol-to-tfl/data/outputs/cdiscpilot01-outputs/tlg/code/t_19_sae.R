# T-19: Serious TEAEs | Source: ADAE | Pop: Safety
source("00_setup.R")
cat("=== T-19: Serious TEAEs ===\n")

adae <- read_adam("adae") %>%
  filter(SAFFL == "Y", TRTEMFL == "Y", AESER == "Y") %>%
  trt_factor()

adsl <- read_adam("adsl") %>% filter(SAFFL == "Y") %>% trt_factor()
denoms <- adsl %>% count(TRT01P, name = "N")

if (nrow(adae) == 0) {
  # No serious TEAEs — create a simple note table
  tbl <- tibble(Note = "No treatment-emergent serious adverse events reported.") %>%
    gt() %>% tab_header(title = "Incidence of Serious TEAEs", subtitle = "Population: Safety")
} else {
  sae_counts <- adae %>%
    distinct(USUBJID, TRT01P, AEBODSYS, AEDECOD) %>%
    count(TRT01P, AEBODSYS, AEDECOD, name = "n") %>%
    left_join(denoms, by = "TRT01P") %>%
    mutate(display = paste0(n, " (", formatC(100 * n / N, format = "f", digits = 1), ")"))

  wide <- sae_counts %>%
    mutate(Term = paste0(AEBODSYS, " / ", AEDECOD)) %>%
    select(Term, TRT01P, display) %>%
    pivot_wider(names_from = TRT01P, values_from = display, values_fill = "0 (0.0)") %>%
    select(Term, any_of(trt_levels))

  tbl <- wide %>%
    gt() %>%
    tab_header(title = "Incidence of Treatment Emergent Serious Adverse Events",
               subtitle = "Population: Safety") %>%
    tab_source_note("Source: ADAE (AESER='Y')")
}

save_table(tbl, "t_19_sae")
