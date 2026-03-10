# ============================================================================
# Name: 06_adqsadas.R
# Description: Create ADQSADAS (ADAS-Cog(11) Questionnaire Analysis Dataset)
# Source SDTM: QS, ADSL
# Supports TLGs: T-5, T-7, T-9, T-11, T-12, T-13, T-14, T-15
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
qs   <- read_sdtm("qs")
adsl <- read_adam("adsl")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN),
    AGE = as.numeric(AGE)
  )

# ---- Filter to ADAS-Cog total score (ACTOT = ADAS-COG(11) Subscore) ----
adas <- qs %>%
  filter(QSCAT == "ALZHEIMER'S DISEASE ASSESSMENT SCALE", QSTESTCD == "ACTOT") %>%
  mutate(
    PARAMCD = "ACTOT",
    PARAM   = "ADAS-Cog(11) Total Score",
    PARAMN  = 1,
    AVAL    = as.numeric(QSSTRESN),
    ADT     = as.Date(substr(QSDTC, 1, 10)),
    VISITNUM_N = as.numeric(VISITNUM)
  )

# ---- Merge ADSL ----
adas <- adas %>%
  left_join(
    adsl %>% select(STUDYID, USUBJID, SITEID, SITEGR1, TRT01P, TRT01A, TRT01PN,
                     TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL, COMP24FL,
                     AGE, AGEGR1, SEX, RACE),
    by = c("STUDYID", "USUBJID")
  ) %>%
  mutate(TRTP = TRT01P, TRTA = TRT01A)

# ---- Analysis visit mapping ----
adas <- adas %>%
  mutate(
    AVISITN = case_when(
      VISITNUM_N == 3 ~ 0,    # Baseline (Week 0)
      VISITNUM_N == 7 ~ 8,    # Week 8
      VISITNUM_N == 9 ~ 16,   # Week 16
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
adas <- adas %>%
  mutate(
    ADY = case_when(
      !is.na(ADT) & !is.na(TRTSDT) & ADT >= TRTSDT ~ as.numeric(ADT - TRTSDT) + 1,
      !is.na(ADT) & !is.na(TRTSDT) & ADT < TRTSDT ~ as.numeric(ADT - TRTSDT),
      TRUE ~ NA_real_
    )
  )

# ---- Baseline flag ----
adas <- adas %>%
  mutate(ABLFL = if_else(AVISITN == 0, "Y", NA_character_))

# ---- Derive baseline and change ----
baseline_vals <- adas %>%
  filter(ABLFL == "Y") %>%
  group_by(USUBJID, PARAMCD) %>%
  slice(1) %>%
  ungroup() %>%
  select(USUBJID, PARAMCD, BASE = AVAL)

adas <- adas %>%
  left_join(baseline_vals, by = c("USUBJID", "PARAMCD")) %>%
  mutate(
    CHG = if_else(!is.na(AVAL) & !is.na(BASE) & AVISITN > 0, AVAL - BASE, NA_real_)
  )

# ---- LOCF imputation ----
# For subjects who dropped out, carry forward last observation to Week 24
# Get all expected post-baseline visits
expected_visits <- tibble(
  AVISITN = c(8, 16, 24),
  AVISIT  = c("Week 8", "Week 16", "Week 24")
)

# Get observed data per subject
adas_obs <- adas %>% filter(AVISITN > 0)

# For each subject, identify missing visits and LOCF from last observed
locf_records <- adas_obs %>%
  group_by(USUBJID, PARAMCD) %>%
  arrange(AVISITN) %>%
  # Get all expected visits
  reframe({
    obs_visits <- cur_data()
    last_obs <- obs_visits %>% slice_max(AVISITN, n = 1)
    missing_visits <- expected_visits %>% filter(AVISITN > last_obs$AVISITN[1])
    if (nrow(missing_visits) > 0) {
      missing_visits %>%
        mutate(
          AVAL = last_obs$AVAL[1],
          BASE = last_obs$BASE[1],
          CHG  = AVAL - BASE,
          DTYPE = "LOCF",
          ABLFL = NA_character_,
          ADT = last_obs$ADT[1],
          ADY = last_obs$ADY[1]
        )
    } else {
      tibble()
    }
  }) %>%
  ungroup()

if (nrow(locf_records) > 0) {
  # Add back ADSL variables for LOCF records
  locf_records <- locf_records %>%
    left_join(
      adsl %>% select(STUDYID, USUBJID, SITEID, SITEGR1, TRT01P, TRT01A, TRT01PN,
                       TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL, COMP24FL,
                       AGE, AGEGR1, SEX, RACE),
      by = "USUBJID"
    ) %>%
    mutate(TRTP = TRT01P, TRTA = TRT01A, PARAMN = 1, PARAM = "ADAS-Cog(11) Total Score")

  # Combine observed + LOCF
  adas <- bind_rows(
    adas %>% mutate(DTYPE = NA_character_),
    locf_records
  )
}

# ---- Analysis record flags ----
adas <- adas %>%
  mutate(
    # ANL01FL: Primary analysis (LOCF at each visit — use LOCF if available, else observed)
    ANL01FL = case_when(
      ABLFL == "Y" ~ "Y",
      AVISITN > 0 ~ "Y",
      TRUE ~ NA_character_
    )
  )

# For primary analysis, keep one record per subject per visit (prefer LOCF over observed for missing)
# Actually, LOCF records are only added for missing visits, observed records are used where available
# So all records with ANL01FL = "Y" are valid for analysis

# ---- Windowed visit flag for completers analysis ----
adas <- adas %>%
  mutate(
    # ANL02FL: Observed cases only (completers analysis, no LOCF)
    ANL02FL = if_else(is.na(DTYPE) & AVISITN > 0, "Y", NA_character_)
  )

# ---- Select and order variables ----
adqsadas <- adas %>%
  select(
    STUDYID, USUBJID, SITEID, SITEGR1,
    TRT01P, TRT01A, TRT01PN, TRTP, TRTA,
    TRTSDT, TRTEDT, SAFFL, ITTFL, EFFFL, COMP24FL,
    AGE, AGEGR1, SEX, RACE,
    PARAMCD, PARAM, PARAMN,
    AVAL, BASE, CHG,
    AVISIT, AVISITN,
    ADT, ADY,
    ABLFL, ANL01FL, ANL02FL, DTYPE
  )

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier", USUBJID = "Unique Subject Identifier",
  SITEID = "Study Site Identifier", SITEGR1 = "Pooled Analysis Site Group 1",
  TRT01P = "Planned Treatment for Period 01", TRT01A = "Actual Treatment for Period 01",
  TRT01PN = "Planned Treatment for Period 01 (N)",
  TRTP = "Planned Treatment", TRTA = "Actual Treatment",
  PARAMCD = "Parameter Code", PARAM = "Parameter Description", PARAMN = "Parameter (N)",
  AVAL = "Analysis Value", BASE = "Baseline Value", CHG = "Change from Baseline",
  AVISIT = "Analysis Visit", AVISITN = "Analysis Visit (N)",
  ADT = "Analysis Date", ADY = "Analysis Relative Day",
  ABLFL = "Baseline Record Flag",
  ANL01FL = "Analysis Record Flag 01 (LOCF)",
  ANL02FL = "Analysis Record Flag 02 (Observed Cases)",
  DTYPE = "Derivation Type",
  SAFFL = "Safety Population Flag", ITTFL = "Intent-to-Treat Population Flag",
  EFFFL = "Efficacy Population Flag", COMP24FL = "Completers of Week 24 Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adqsadas)) attr(adqsadas[[v]], "label") <- var_labels[[v]]
}
attr(adqsadas, "label") <- "ADAS-Cog(11) Questionnaire Analysis Dataset"

# ---- Export ----
export_adam(adqsadas, "adqsadas")

cat("\n=== ADQSADAS Summary ===\n")
cat("Total records:", nrow(adqsadas), "\n")
cat("Subjects:", length(unique(adqsadas$USUBJID)), "\n")
cat("Observed records:", sum(is.na(adqsadas$DTYPE)), "\n")
cat("LOCF records:", sum(adqsadas$DTYPE == "LOCF", na.rm = TRUE), "\n")
cat("Records by visit:\n")
print(table(adqsadas$AVISIT, useNA = "always"))
