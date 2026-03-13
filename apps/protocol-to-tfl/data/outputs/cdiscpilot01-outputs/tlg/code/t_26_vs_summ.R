# T-26: Vital Signs at Baseline and End of Treatment | Source: ADVS | Pop: Safety
source("00_setup.R")
cat("=== T-26: Vital Signs at Baseline and End of Treatment ===\n")

advs <- read_adam("advs") %>%
  filter(SAFFL == "Y", ANL01FL == "Y") %>%
  mutate(AVAL = as.numeric(AVAL), BASE = as.numeric(BASE)) %>%
  trt_factor()

# Baseline and EOT records
bl <- advs %>% filter(AVISITN == 0)
eot <- advs %>% filter(ABLFL != "Y", AVISITN > 0) %>%
  group_by(USUBJID, TRT01P, PARAMCD, PARAM) %>%
  filter(AVISITN == max(AVISITN)) %>%
  ungroup()

# Key VS parameters
key_params <- c("SYSBP", "DIABP", "PULSE", "TEMP", "WEIGHT", "HEIGHT")

build_desc <- function(data, label) {
  data %>%
    filter(PARAMCD %in% key_params) %>%
    group_by(TRT01P, PARAMCD, PARAM) %>%
    summarise(n = n(), mean = mean(AVAL, na.rm = TRUE), sd = sd(AVAL, na.rm = TRUE),
              median = median(AVAL, na.rm = TRUE),
              min = min(AVAL, na.rm = TRUE), max = max(AVAL, na.rm = TRUE),
              .groups = "drop") %>%
    mutate(display = paste0(formatC(mean, format = "f", digits = 1), " (",
                            formatC(sd, format = "f", digits = 2), ")"),
           Timepoint = label)
}

bl_desc <- build_desc(bl, "Baseline")
eot_desc <- build_desc(eot, "End of Treatment")

combined <- bind_rows(bl_desc, eot_desc) %>%
  select(PARAM, Timepoint, TRT01P, display) %>%
  pivot_wider(names_from = TRT01P, values_from = display, values_fill = "-") %>%
  arrange(PARAM, Timepoint) %>%
  select(PARAM, Timepoint, all_of(trt_levels))

tbl <- combined %>%
  gt(groupname_col = "PARAM") %>%
  tab_header(title = "Vital Signs Summary: Baseline and End of Treatment",
             subtitle = "Population: Safety | Mean (SD)") %>%
  tab_source_note("Source: ADVS")

save_table(tbl, "t_26_vs_summ")
