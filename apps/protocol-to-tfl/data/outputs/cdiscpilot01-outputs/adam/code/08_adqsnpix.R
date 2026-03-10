# ============================================================================
# Name: 08_adqsnpix.R
# Description: Create ADQSNPIX (NPI-X Questionnaire Analysis Dataset)
# Source SDTM: QS, ADSL
# Supports TLGs: T-16
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
qs   <- read_sdtm("qs")
adsl <- read_adam("adsl")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN)
  )

# ---- Filter to NPI-X Total (9) score ----
# NPTOT = NPI-X (9) Total Score (derived, excludes sleep, appetite, euphoria)
npix <- qs %>%
  filter(
    QSCAT == "NEUROPSYCHIATRIC INVENTORY - REVISED (NPI-X)",
    QSTESTCD == "NPTOT"
  ) %>%
  mutate(
    PARAMCD = "NPTOT",
    PARAM   = "NPI-X Total (9) Score",
    PARAMN  = 1,
    AVAL    = as.numeric(QSSTRESN),
    ADT     = as.Date(substr(QSDTC, 1, 10)),
    VISITNUM_N = as.numeric(VISITNUM)
  )

# ---- Merge ADSL ----
npix <- npix %>%
  left_join(
    adsl %>% select(
      STUDYID, USUBJID, SITEID, SITEGR1,
      TRT01P, TRT01A, TRT01PN,
      TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL
    ),
    by = c("STUDYID", "USUBJID")
  ) %>%
  mutate(TRTP = TRT01P, TRTA = TRT01A)

# ---- Analysis visit mapping ----
# NPI-X is assessed at Weeks 4, 8, 12, 16, 20, 24
# T-16 uses windowed mean from Week 4 through Week 24
# But we also need baseline for the ANCOVA
npix <- npix %>%
  mutate(
    AVISITN = case_when(
      VISITNUM_N == 3 ~ 0,    # Baseline
      VISITNUM_N == 5 ~ 4,    # Week 4
      VISITNUM_N == 7 ~ 8,    # Week 8
      VISITNUM_N == 8 ~ 12,   # Week 12
      VISITNUM_N == 9 ~ 16,   # Week 16
      VISITNUM_N == 10 ~ 20,  # Week 20
      VISITNUM_N == 11 ~ 24,  # Week 24
      TRUE ~ NA_real_
    ),
    AVISIT = case_when(
      AVISITN == 0 ~ "Baseline",
      !is.na(AVISITN) ~ paste("Week", AVISITN),
      TRUE ~ NA_character_
    )
  ) %>%
  filter(!is.na(AVAL), !is.na(AVISITN))

# ---- Study day ----
npix <- npix %>%
  mutate(
    ADY = case_when(
      !is.na(ADT) & !is.na(TRTSDT) & ADT >= TRTSDT ~
        as.numeric(ADT - TRTSDT) + 1,
      !is.na(ADT) & !is.na(TRTSDT) & ADT < TRTSDT ~
        as.numeric(ADT - TRTSDT),
      TRUE ~ NA_real_
    )
  )

# ---- Baseline ----
npix <- npix %>%
  mutate(ABLFL = if_else(AVISITN == 0, "Y", NA_character_))

baseline_vals <- npix %>%
  filter(ABLFL == "Y") %>%
  group_by(USUBJID, PARAMCD) %>%
  slice(1) %>%
  ungroup() %>%
  select(USUBJID, PARAMCD, BASE = AVAL)

npix <- npix %>%
  left_join(baseline_vals, by = c("USUBJID", "PARAMCD")) %>%
  mutate(
    CHG = if_else(
      !is.na(AVAL) & !is.na(BASE) & AVISITN > 0,
      AVAL - BASE, NA_real_
    )
  )

# ---- Derive mean NPI-X score from Week 4-24 (windowed endpoint) ----
# Per T-16: endpoint = mean of all available total scores Week 4-24
npix_mean <- npix %>%
  filter(AVISITN >= 4 & AVISITN <= 24) %>%
  group_by(STUDYID, USUBJID, PARAMCD) %>%
  summarise(
    AVAL_MEAN = mean(AVAL, na.rm = TRUE),
    N_SCORES  = n(),
    .groups   = "drop"
  )

# Create a derived "mean" parameter record per subject
npix_mean_records <- npix_mean %>%
  left_join(
    adsl %>% select(
      STUDYID, USUBJID, SITEID, SITEGR1,
      TRT01P, TRT01A, TRT01PN,
      TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL
    ),
    by = c("STUDYID", "USUBJID")
  ) %>%
  left_join(baseline_vals, by = c("USUBJID", "PARAMCD")) %>%
  mutate(
    PARAMCD = "NPTOTMN",
    PARAM = "NPI-X Total (9) Mean Score (Wk 4-24)",
    PARAMN = 2,
    AVAL = AVAL_MEAN,
    CHG = AVAL - BASE,
    AVISIT = "Week 4-24 Mean",
    AVISITN = 99,
    ADT = NA_Date_,
    ADY = NA_real_,
    ABLFL = NA_character_,
    DTYPE = "AVERAGE",
    TRTP = TRT01P,
    TRTA = TRT01A
  ) %>%
  select(-AVAL_MEAN, -N_SCORES)

# Combine
adqsnpix <- bind_rows(
  npix %>% mutate(DTYPE = NA_character_),
  npix_mean_records
) %>%
  mutate(ANL01FL = "Y") %>%
  select(
    STUDYID, USUBJID, SITEID, SITEGR1,
    TRT01P, TRT01A, TRT01PN, TRTP, TRTA,
    TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL,
    PARAMCD, PARAM, PARAMN,
    AVAL, BASE, CHG,
    AVISIT, AVISITN,
    ADT, ADY,
    ABLFL, ANL01FL, DTYPE
  )

# ---- Assign labels ----
var_labels <- c(
  PARAMCD = "Parameter Code",
  PARAM = "Parameter Description",
  AVAL = "Analysis Value",
  BASE = "Baseline Value",
  CHG = "Change from Baseline",
  AVISIT = "Analysis Visit",
  AVISITN = "Analysis Visit (N)",
  ANL01FL = "Analysis Record Flag 01",
  DTYPE = "Derivation Type",
  EFFFL = "Efficacy Population Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adqsnpix)) {
    attr(adqsnpix[[v]], "label") <- var_labels[[v]]
  }
}
attr(adqsnpix, "label") <- "NPI-X Questionnaire Analysis Dataset"

# ---- Export ----
export_adam(adqsnpix, "adqsnpix")

cat("\n=== ADQSNPIX Summary ===\n")
cat("Total records:", nrow(adqsnpix), "\n")
cat("Subjects:", length(unique(adqsnpix$USUBJID)), "\n")
cat("Parameters:", paste(unique(adqsnpix$PARAMCD), collapse = ", "), "\n")
cat("Records by visit:\n")
print(table(adqsnpix$AVISIT, useNA = "always"))
