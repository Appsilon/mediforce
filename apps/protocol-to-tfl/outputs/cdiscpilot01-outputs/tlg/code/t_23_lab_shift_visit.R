# T-23: Lab Shift Table by Visit | Source: ADLB | Pop: Safety
source("00_setup.R")
cat("=== T-23: Lab Shift Table by Visit ===\n")

adlb <- read_adam("adlb") %>%
  filter(SAFFL == "Y", ANL01FL == "Y", !is.na(BNRIND), !is.na(ANRIND)) %>%
  trt_factor()

# Select top parameters for readability
top_params <- adlb %>%
  filter(AVISITN > 0) %>%
  count(PARAMCD, PARAM, sort = TRUE) %>%
  head(10)

shift_data <- adlb %>%
  filter(PARAMCD %in% top_params$PARAMCD, AVISITN > 0) %>%
  mutate(BNRIND = factor(BNRIND, levels = c("LOW", "NORMAL", "HIGH")),
         ANRIND = factor(ANRIND, levels = c("LOW", "NORMAL", "HIGH")),
         AVISIT = factor(AVISIT))

# Count shifts per param, visit, treatment
shift_counts <- shift_data %>%
  count(TRT01P, PARAMCD, PARAM, AVISIT, BNRIND, ANRIND, name = "n") %>%
  mutate(Shift = paste0(BNRIND, " -> ", ANRIND))

# Pivot for display
wide <- shift_counts %>%
  select(TRT01P, PARAM, AVISIT, Shift, n) %>%
  pivot_wider(names_from = TRT01P, values_from = n, values_fill = 0) %>%
  arrange(PARAM, AVISIT, Shift) %>%
  select(PARAM, AVISIT, Shift, all_of(trt_levels))

tbl <- wide %>%
  gt(groupname_col = "PARAM") %>%
  tab_header(title = "Shift Table for Laboratory Parameters by Visit",
             subtitle = "Population: Safety | Subject counts") %>%
  tab_source_note("Source: ADLB | Baseline vs post-baseline normal range indicator")

save_table(tbl, "t_23_lab_shift_visit")
