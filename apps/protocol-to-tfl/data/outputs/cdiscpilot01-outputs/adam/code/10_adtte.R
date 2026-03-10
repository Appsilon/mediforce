# ============================================================================
# Name: 10_adtte.R
# Description: Create ADTTE (Time-to-Event Analysis Dataset)
# Source SDTM: ADSL, ADAE
# Supports TLGs: F-1 (Time to First Dermatological Event)
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
adsl <- read_adam("adsl")
adae <- read_adam("adae")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN),
    AGE = as.numeric(AGE)
  )

adae <- adae %>%
  mutate(
    ASTDT = as.Date(ASTDT),
    AENDT = as.Date(AENDT)
  )

# ---- Parameter: Time to First Dermatological Event ----
# Event: first TEAE flagged as dermatological
derm_events <- adae %>%
  filter(TRTEMFL == "Y", CQ01NAM == "DERMATOLOGICAL EVENTS") %>%
  group_by(USUBJID) %>%
  slice_min(ASTDT, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  select(USUBJID, EVENT_DT = ASTDT) %>%
  mutate(CNSR = 0, EVNTDESC = "Dermatological Adverse Event")

# Censoring: last treatment date for subjects without event
adtte_derm <- adsl %>%
  filter(SAFFL == "Y") %>%
  select(
    STUDYID, USUBJID, SITEID,
    TRT01P, TRT01A, TRT01PN,
    TRTSDT, TRTEDT, SAFFL, ITTFL,
    AGE, AGEGR1, SEX, RACE
  ) %>%
  left_join(derm_events, by = "USUBJID") %>%
  mutate(
    # If no event, censor at last treatment date
    CNSR = if_else(is.na(CNSR), 1, CNSR),
    ADT = case_when(
      CNSR == 0 ~ EVENT_DT,
      TRUE ~ TRTEDT
    ),
    EVNTDESC = if_else(
      is.na(EVNTDESC),
      "Censored at Last Treatment Date",
      EVNTDESC
    ),
    CNSDTDSC = if_else(
      CNSR == 1,
      "Date of Last Exposure to Treatment",
      NA_character_
    ),
    STARTDT = TRTSDT,
    # AVAL = time in days from first dose to event/censor
    AVAL = as.numeric(ADT - STARTDT) + 1,
    # Convert to weeks for display
    AVAL_W = round(AVAL / 7, 1),
    PARAMCD = "TTDERM",
    PARAM = "Time to First Dermatological Event (days)",
    PARAMN = 1
  ) %>%
  filter(!is.na(AVAL) & AVAL > 0) %>%
  mutate(
    TRTP = TRT01P,
    TRTA = TRT01A
  ) %>%
  select(
    STUDYID, USUBJID, SITEID,
    TRT01P, TRT01A, TRT01PN, TRTP, TRTA,
    TRTSDT, TRTEDT, SAFFL, ITTFL,
    AGE, AGEGR1, SEX, RACE,
    PARAMCD, PARAM, PARAMN,
    AVAL, STARTDT, ADT,
    CNSR, EVNTDESC, CNSDTDSC
  )

adtte <- adtte_derm

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier",
  USUBJID = "Unique Subject Identifier",
  PARAMCD = "Parameter Code",
  PARAM = "Parameter Description",
  AVAL = "Analysis Value (days)",
  CNSR = "Censor (0=event, 1=censored)",
  EVNTDESC = "Event or Censoring Description",
  CNSDTDSC = "Censor Date Description",
  STARTDT = "Time-to-Event Origin Date",
  ADT = "Analysis Date"
)
for (v in names(var_labels)) {
  if (v %in% names(adtte)) {
    attr(adtte[[v]], "label") <- var_labels[[v]]
  }
}
attr(adtte, "label") <- "Time-to-Event Analysis Dataset"

# ---- Export ----
export_adam(adtte, "adtte")

cat("\n=== ADTTE Summary ===\n")
cat("Total records:", nrow(adtte), "\n")
cat("Events:", sum(adtte$CNSR == 0), "\n")
cat("Censored:", sum(adtte$CNSR == 1), "\n")
cat("Events by arm:\n")
print(
  table(adtte$TRT01P, adtte$CNSR, dnn = c("Arm", "Censored"))
)
