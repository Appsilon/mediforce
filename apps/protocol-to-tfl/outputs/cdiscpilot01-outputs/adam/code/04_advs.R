# ============================================================================
# Name: 04_advs.R
# Description: Create ADVS (Vital Signs Analysis Dataset)
# Source SDTM: VS, ADSL
# Supports TLGs: T-26, T-27, T-28
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
vs   <- read_sdtm("vs")
adsl <- read_adam("adsl")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN)
  )

# ---- Build ADVS ----
advs <- vs %>%
  filter(!is.na(VSSTRESN) | VSSTAT == "NOT DONE") %>%
  mutate(
    AVAL = as.numeric(VSSTRESN),
    ADT  = as.Date(substr(VSDTC, 1, 10)),
    VISITNUM_N = as.numeric(VISITNUM)
  ) %>%
  # Create position-specific parameter codes
  mutate(
    VSPOS_SHORT = case_when(
      str_detect(toupper(VSPOS), "SUPINE|LYING") ~ "SUPINE",
      str_detect(toupper(VSTPT), "STANDING.*1") | str_detect(toupper(VSTPT), "1 MIN") ~ "STAND1",
      str_detect(toupper(VSTPT), "STANDING.*3") | str_detect(toupper(VSTPT), "3 MIN") ~ "STAND3",
      str_detect(toupper(VSPOS), "STANDING") ~ "STAND",
      TRUE ~ ""
    ),
    PARAMCD = case_when(
      VSTESTCD == "SYSBP" & VSPOS_SHORT != "" ~ paste0(VSTESTCD, "_", VSPOS_SHORT),
      VSTESTCD == "DIABP" & VSPOS_SHORT != "" ~ paste0(VSTESTCD, "_", VSPOS_SHORT),
      VSTESTCD == "PULSE" & VSPOS_SHORT != "" ~ paste0("HR_", VSPOS_SHORT),
      VSTESTCD == "PULSE" & VSPOS_SHORT == "" ~ "HR",
      TRUE ~ VSTESTCD
    ),
    PARAM = case_when(
      VSTESTCD %in% c("SYSBP", "DIABP") & VSPOS_SHORT != "" ~
        paste0(VSTEST, " ", VSPOS_SHORT, " (", VSSTRESU, ")"),
      VSTESTCD == "PULSE" & VSPOS_SHORT != "" ~
        paste0("Heart Rate ", VSPOS_SHORT, " (", VSSTRESU, ")"),
      TRUE ~ paste0(VSTEST, " (", VSSTRESU, ")")
    ),
    ATPT  = VSTPT,
    ATPTN = as.numeric(VSTPTNUM)
  ) %>%
  # Merge ADSL
  left_join(
    adsl %>% select(STUDYID, USUBJID, SITEID, TRT01P, TRT01A, TRT01PN,
                     TRTSDT, TRTEDT, SAFFL, ITTFL),
    by = c("STUDYID", "USUBJID")
  ) %>%
  mutate(TRTP = TRT01P, TRTA = TRT01A) %>%
  # Analysis visit
  mutate(
    AVISITN = case_when(
      VISITNUM_N == 1 ~ -2,  # Screening
      VISITNUM_N == 2 ~ -1,  # Run-in
      VISITNUM_N == 3 ~ 0,   # Baseline (Week 0)
      VISITNUM_N == 4 ~ 2,
      VISITNUM_N == 5 ~ 4,
      VISITNUM_N == 6 ~ 6,
      VISITNUM_N == 7 ~ 8,
      VISITNUM_N == 8 ~ 12,
      VISITNUM_N == 9 ~ 16,
      VISITNUM_N == 10 ~ 20,
      VISITNUM_N == 11 ~ 24,
      VISITNUM_N == 12 ~ 26,
      TRUE ~ NA_real_
    ),
    AVISIT = case_when(
      AVISITN == -2 ~ "Screening",
      AVISITN == -1 ~ "Run-in",
      AVISITN == 0 ~ "Baseline",
      !is.na(AVISITN) ~ paste("Week", AVISITN),
      TRUE ~ NA_character_
    )
  ) %>%
  filter(!is.na(AVAL)) %>%
  # Study day
  mutate(
    ADY = case_when(
      !is.na(ADT) & !is.na(TRTSDT) & ADT >= TRTSDT ~ as.numeric(ADT - TRTSDT) + 1,
      !is.na(ADT) & !is.na(TRTSDT) & ADT < TRTSDT ~ as.numeric(ADT - TRTSDT),
      TRUE ~ NA_real_
    )
  ) %>%
  # Baseline flag from SDTM
  mutate(ABLFL = if_else(VSBLFL == "Y", "Y", NA_character_))

# ---- Derive baseline ----
baseline_vals <- advs %>%
  filter(ABLFL == "Y") %>%
  group_by(USUBJID, PARAMCD) %>%
  slice(1) %>%
  ungroup() %>%
  select(USUBJID, PARAMCD, BASE = AVAL)

advs <- advs %>%
  left_join(baseline_vals, by = c("USUBJID", "PARAMCD")) %>%
  mutate(
    CHG = if_else(!is.na(AVAL) & !is.na(BASE), AVAL - BASE, NA_real_)
  ) %>%
  # Analysis flag: baseline + on-treatment scheduled visits
  mutate(
    ANL01FL = case_when(
      ABLFL == "Y" ~ "Y",
      !is.na(ADY) & ADY > 0 & !is.na(AVISITN) & AVISITN > 0 ~ "Y",
      TRUE ~ NA_character_
    )
  )

# ---- End of treatment record flag ----
# Last on-treatment record per subject per parameter
eot <- advs %>%
  filter(ANL01FL == "Y", !is.na(ADY), ADY > 0) %>%
  group_by(USUBJID, PARAMCD) %>%
  slice_max(order_by = ADT, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  mutate(EOTFL = "Y") %>%
  select(USUBJID, PARAMCD, ADT, EOTFL)

advs <- advs %>%
  left_join(eot, by = c("USUBJID", "PARAMCD", "ADT"))

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier", USUBJID = "Unique Subject Identifier",
  PARAMCD = "Parameter Code", PARAM = "Parameter Description",
  AVAL = "Analysis Value", BASE = "Baseline Value", CHG = "Change from Baseline",
  ABLFL = "Baseline Record Flag", ANL01FL = "Analysis Record Flag 01",
  EOTFL = "End of Treatment Record Flag",
  AVISIT = "Analysis Visit", AVISITN = "Analysis Visit (N)",
  ADT = "Analysis Date", ADY = "Analysis Relative Day",
  ATPT = "Analysis Timepoint", ATPTN = "Analysis Timepoint (N)",
  TRTP = "Planned Treatment", TRTA = "Actual Treatment",
  SAFFL = "Safety Population Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(advs)) attr(advs[[v]], "label") <- var_labels[[v]]
}
attr(advs, "label") <- "Vital Signs Analysis Dataset"

# ---- Export ----
export_adam(advs, "advs")

cat("\n=== ADVS Summary ===\n")
cat("Total records:", nrow(advs), "\n")
cat("Parameters:", length(unique(advs$PARAMCD)), "\n")
cat("Subjects:", length(unique(advs$USUBJID)), "\n")
