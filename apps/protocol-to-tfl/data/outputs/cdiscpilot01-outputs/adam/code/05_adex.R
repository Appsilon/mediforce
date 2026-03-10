# ============================================================================
# Name: 05_adex.R
# Description: Create ADEX (Exposure Analysis Dataset)
# Source SDTM: EX, ADSL
# Supports TLGs: T-17
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
ex   <- read_sdtm("ex")
adsl <- read_adam("adsl")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN),
    TRTDUR = as.numeric(TRTDUR)
  )

# ---- Calculate subject-level exposure parameters ----
ex_subj <- ex %>%
  mutate(
    EXSTDT = as.Date(substr(EXSTDTC, 1, 10)),
    EXENDT = as.Date(substr(EXENDTC, 1, 10)),
    EXDOSE_N = as.numeric(EXDOSE)
  ) %>%
  group_by(STUDYID, USUBJID) %>%
  summarise(
    TOTAL_DOSE = sum(EXDOSE_N * (as.numeric(EXENDT - EXSTDT) + 1), na.rm = TRUE),
    FIRST_DOSE = min(EXSTDT, na.rm = TRUE),
    LAST_DOSE_END = max(EXENDT, na.rm = TRUE),
    PLANNED_DOSE = first(EXDOSE_N),  # Planned daily dose from first record
    .groups = "drop"
  ) %>%
  mutate(
    FIRST_DOSE = if_else(is.infinite(FIRST_DOSE), NA_Date_, FIRST_DOSE),
    LAST_DOSE_END = if_else(is.infinite(LAST_DOSE_END), NA_Date_, LAST_DOSE_END),
    EXP_DAYS = as.numeric(LAST_DOSE_END - FIRST_DOSE) + 1
  )

# ---- Build ADEX as BDS with derived parameters ----
adex_rows <- list()

# Merge ADSL variables
adsl_vars <- adsl %>%
  select(STUDYID, USUBJID, SITEID, TRT01P, TRT01A, TRT01PN,
         TRTSDT, TRTEDT, TRTDUR, SAFFL, ITTFL)

ex_merged <- ex_subj %>%
  left_join(adsl_vars, by = c("STUDYID", "USUBJID"))

# Parameter 1: Average daily dose (mg)
avgdd <- ex_merged %>%
  mutate(
    PARAMCD = "AVGDD",
    PARAM   = "Average Daily Dose (mg)",
    PARAMN  = 1,
    AVAL    = if_else(EXP_DAYS > 0, round(TOTAL_DOSE / EXP_DAYS, 1), NA_real_)
  )

# Parameter 2: Cumulative dose (mg)
cumd <- ex_merged %>%
  mutate(
    PARAMCD = "CUMD",
    PARAM   = "Cumulative Dose (mg)",
    PARAMN  = 2,
    AVAL    = TOTAL_DOSE
  )

# Parameter 3: Treatment duration (days)
trtdur <- ex_merged %>%
  mutate(
    PARAMCD = "TRTDUR",
    PARAM   = "Duration of Treatment (days)",
    PARAMN  = 3,
    AVAL    = as.numeric(EXP_DAYS)
  )

# Combine all parameters
adex <- bind_rows(avgdd, cumd, trtdur) %>%
  mutate(
    TRTP = TRT01P,
    TRTA = TRT01A,
    AVISIT = "End of Study",
    AVISITN = 99
  ) %>%
  select(STUDYID, USUBJID, SITEID, TRT01P, TRT01A, TRT01PN,
         TRTP, TRTA, TRTSDT, TRTEDT, SAFFL, ITTFL,
         PARAMCD, PARAM, PARAMN, AVAL, AVISIT, AVISITN) %>%
  filter(!is.na(AVAL))

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier", USUBJID = "Unique Subject Identifier",
  PARAMCD = "Parameter Code", PARAM = "Parameter Description", PARAMN = "Parameter (N)",
  AVAL = "Analysis Value",
  AVISIT = "Analysis Visit", AVISITN = "Analysis Visit (N)",
  TRTP = "Planned Treatment", TRTA = "Actual Treatment",
  SAFFL = "Safety Population Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adex)) attr(adex[[v]], "label") <- var_labels[[v]]
}
attr(adex, "label") <- "Exposure Analysis Dataset"

# ---- Export ----
export_adam(adex, "adex")

cat("\n=== ADEX Summary ===\n")
cat("Total records:", nrow(adex), "\n")
cat("Parameters:", paste(unique(adex$PARAMCD), collapse = ", "), "\n")
cat("Subjects:", length(unique(adex$USUBJID)), "\n")
