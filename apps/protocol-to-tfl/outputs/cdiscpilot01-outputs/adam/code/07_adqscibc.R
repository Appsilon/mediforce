# ============================================================================
# Name: 07_adqscibc.R
# Description: Create ADQSCIBC (CIBIC+ Questionnaire Analysis Dataset)
# Source SDTM: QS, ADSL
# Supports TLGs: T-6, T-8, T-10
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

# ---- Filter to CIBIC+ ----
cibic <- qs %>%
  filter(
    QSCAT == "CLINICIAN'S INTERVIEW-BASED IMPRESSION OF CHANGE (CIBIC+)",
    QSTESTCD == "CIBIC"
  ) %>%
  mutate(
    PARAMCD = "CIBIC",
    PARAM   = "CIBIC+ Score",
    PARAMN  = 1,
    AVAL    = as.numeric(QSSTRESN),
    AVALC   = QSSTRESC,
    ADT     = as.Date(substr(QSDTC, 1, 10)),
    VISITNUM_N = as.numeric(VISITNUM)
  )

# ---- Merge ADSL ----
cibic <- cibic %>%
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
cibic <- cibic %>%
  mutate(
    AVISITN = case_when(
      VISITNUM_N == 7 ~ 8,
      VISITNUM_N == 9 ~ 16,
      VISITNUM_N == 11 ~ 24,
      TRUE ~ NA_real_
    ),
    AVISIT = case_when(
      !is.na(AVISITN) ~ paste("Week", AVISITN),
      TRUE ~ NA_character_
    )
  ) %>%
  filter(!is.na(AVAL), !is.na(AVISITN))

# ---- Study day ----
cibic <- cibic %>%
  mutate(
    ADY = case_when(
      !is.na(ADT) & !is.na(TRTSDT) & ADT >= TRTSDT ~
        as.numeric(ADT - TRTSDT) + 1,
      !is.na(ADT) & !is.na(TRTSDT) & ADT < TRTSDT ~
        as.numeric(ADT - TRTSDT),
      TRUE ~ NA_real_
    )
  )

# Note: CIBIC+ has no baseline score (it IS a change measure)
# So BASE and CHG are not applicable
cibic <- cibic %>%
  mutate(
    ABLFL = NA_character_,
    BASE  = NA_real_,
    CHG   = NA_real_
  )

# ---- LOCF imputation ----
expected_visits <- tibble(
  AVISITN = c(8, 16, 24),
  AVISIT  = c("Week 8", "Week 16", "Week 24")
)

locf_records <- cibic %>%
  group_by(USUBJID, PARAMCD) %>%
  arrange(AVISITN) %>%
  reframe({
    obs <- cur_data()
    last_obs <- obs %>% slice_max(AVISITN, n = 1)
    missing <- expected_visits %>%
      filter(AVISITN > last_obs$AVISITN[1])
    if (nrow(missing) > 0) {
      missing %>%
        mutate(
          AVAL = last_obs$AVAL[1],
          AVALC = last_obs$AVALC[1],
          DTYPE = "LOCF",
          ADT = last_obs$ADT[1],
          ADY = last_obs$ADY[1],
          ABLFL = NA_character_,
          BASE = NA_real_,
          CHG = NA_real_
        )
    } else {
      tibble()
    }
  }) %>%
  ungroup()

if (nrow(locf_records) > 0) {
  locf_records <- locf_records %>%
    left_join(
      adsl %>% select(
        STUDYID, USUBJID, SITEID, SITEGR1,
        TRT01P, TRT01A, TRT01PN,
        TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL
      ),
      by = "USUBJID"
    ) %>%
    mutate(
      TRTP = TRT01P, TRTA = TRT01A,
      PARAMN = 1, PARAM = "CIBIC+ Score"
    )

  cibic <- bind_rows(
    cibic %>% mutate(DTYPE = NA_character_),
    locf_records
  )
}

# ---- Analysis flags ----
cibic <- cibic %>%
  mutate(
    ANL01FL = "Y",
    ANL02FL = if_else(
      is.na(DTYPE), "Y", NA_character_
    )
  )

# ---- Select variables ----
adqscibc <- cibic %>%
  select(
    STUDYID, USUBJID, SITEID, SITEGR1,
    TRT01P, TRT01A, TRT01PN, TRTP, TRTA,
    TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL,
    PARAMCD, PARAM, PARAMN,
    AVAL, AVALC, BASE, CHG,
    AVISIT, AVISITN,
    ADT, ADY,
    ABLFL, ANL01FL, ANL02FL, DTYPE
  )

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier",
  USUBJID = "Unique Subject Identifier",
  PARAMCD = "Parameter Code",
  PARAM = "Parameter Description",
  AVAL = "Analysis Value",
  AVALC = "Analysis Value (C)",
  AVISIT = "Analysis Visit",
  AVISITN = "Analysis Visit (N)",
  ANL01FL = "Analysis Record Flag 01 (LOCF)",
  ANL02FL = "Analysis Record Flag 02 (Observed)",
  DTYPE = "Derivation Type",
  EFFFL = "Efficacy Population Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adqscibc)) {
    attr(adqscibc[[v]], "label") <- var_labels[[v]]
  }
}
attr(adqscibc, "label") <- "CIBIC+ Questionnaire Analysis Dataset"

# ---- Export ----
export_adam(adqscibc, "adqscibc")

cat("\n=== ADQSCIBC Summary ===\n")
cat("Total records:", nrow(adqscibc), "\n")
cat("Subjects:", length(unique(adqscibc$USUBJID)), "\n")
cat("Observed:", sum(is.na(adqscibc$DTYPE)), "\n")
cat("LOCF:", sum(adqscibc$DTYPE == "LOCF", na.rm = TRUE), "\n")
cat("Records by visit:\n")
print(table(adqscibc$AVISIT, useNA = "always"))
