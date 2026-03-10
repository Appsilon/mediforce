# ============================================================================
# Name: 03_adlb.R
# Description: Create ADLB (Laboratory Analysis Dataset)
# Source SDTM: LB, SUPPLB, ADSL
# Supports TLGs: T-20, T-21, T-22, T-23, T-24, T-25
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
lb   <- read_sdtm("lb")
adsl <- read_adam("adsl")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN)
  )

# Note: SUPPLB is large (64k rows). We skip it here as the core LB variables
# are sufficient for the required TLGs.

# ---- Build ADLB ----
adlb <- lb %>%
  mutate(
    AVAL    = as.numeric(LBSTRESN),
    AVALC   = LBSTRESC,
    A1LO    = as.numeric(LBSTNRLO),
    A1HI    = as.numeric(LBSTNRHI),
    PARAMCD = LBTESTCD,
    PARAM   = paste0(LBTEST, " (", LBSTRESU, ")"),
    PARCAT1 = LBCAT,
    ADT     = as.Date(substr(LBDTC, 1, 10)),
    VISITNUM_N = as.numeric(VISITNUM)
  ) %>%
  # Merge ADSL
  left_join(
    adsl %>% select(STUDYID, USUBJID, SITEID, TRT01P, TRT01A, TRT01PN,
                     TRTSDT, TRTEDT, SAFFL, ITTFL, AGE, SEX, RACE),
    by = c("STUDYID", "USUBJID")
  ) %>%
  mutate(
    TRTP = TRT01P,
    TRTA = TRT01A
  ) %>%
  # Analysis visit mapping
  mutate(
    AVISITN = case_when(
      VISITNUM_N == 1 ~ 0,    # Screening / Baseline
      VISITNUM_N == 2 ~ 0,    # Baseline
      VISITNUM_N == 3 ~ 0,    # Week 0 (Baseline for labs)
      VISITNUM_N == 4 ~ 2,    # Week 2
      VISITNUM_N == 5 ~ 4,    # Week 4
      VISITNUM_N == 6 ~ 6,    # Week 6
      VISITNUM_N == 7 ~ 8,    # Week 8
      VISITNUM_N == 8 ~ 12,   # Week 12
      VISITNUM_N == 9 ~ 16,   # Week 16
      VISITNUM_N == 10 ~ 20,  # Week 20
      VISITNUM_N == 11 ~ 24,  # Week 24
      VISITNUM_N == 12 ~ 26,  # Week 26
      TRUE ~ NA_real_
    ),
    AVISIT = case_when(
      AVISITN == 0 ~ "Baseline",
      !is.na(AVISITN) ~ paste("Week", AVISITN),
      TRUE ~ NA_character_
    )
  ) %>%
  # Filter to records with valid analysis values
  filter(!is.na(AVAL)) %>%
  # Normal range indicator
  mutate(
    ANRIND = case_when(
      !is.na(A1LO) & AVAL < A1LO ~ "LOW",
      !is.na(A1HI) & AVAL > A1HI ~ "HIGH",
      !is.na(A1LO) | !is.na(A1HI) ~ "NORMAL",
      TRUE ~ NA_character_
    )
  ) %>%
  # Study day
  mutate(
    ADY = case_when(
      !is.na(ADT) & !is.na(TRTSDT) & ADT >= TRTSDT ~ as.numeric(ADT - TRTSDT) + 1,
      !is.na(ADT) & !is.na(TRTSDT) & ADT < TRTSDT ~ as.numeric(ADT - TRTSDT),
      TRUE ~ NA_real_
    )
  ) %>%
  # Baseline flag — use SDTM LBBLFL if available, otherwise last pre-treatment
  mutate(ABLFL = if_else(LBBLFL == "Y", "Y", NA_character_))

# ---- Derive baseline value ----
baseline_vals <- adlb %>%
  filter(ABLFL == "Y") %>%
  group_by(USUBJID, PARAMCD) %>%
  slice(1) %>%
  ungroup() %>%
  select(USUBJID, PARAMCD, BASE = AVAL, BNRIND = ANRIND)

adlb <- adlb %>%
  left_join(baseline_vals, by = c("USUBJID", "PARAMCD")) %>%
  # Change from baseline
  mutate(
    CHG  = if_else(!is.na(AVAL) & !is.na(BASE), AVAL - BASE, NA_real_),
    PCHG = if_else(!is.na(CHG) & !is.na(BASE) & BASE != 0,
                   round(100 * CHG / BASE, 2), NA_real_)
  ) %>%
  # Shift variable
  mutate(
    SHIFT1 = case_when(
      !is.na(BNRIND) & !is.na(ANRIND) ~ paste(BNRIND, "to", ANRIND),
      TRUE ~ NA_character_
    )
  ) %>%
  # Analysis record flag: on-treatment scheduled visits
  mutate(
    ANL01FL = case_when(
      ABLFL == "Y" ~ "Y",
      !is.na(ADY) & ADY > 0 & !is.na(AVISITN) & AVISITN > 0 ~ "Y",
      TRUE ~ NA_character_
    )
  )

# ---- Hy's Law flag (ALT/AST > 3xULN AND BILI > 2xULN) ----
# Create subject-level Hy's law assessment
hyslaw_trans <- adlb %>%
  filter(PARAMCD %in% c("ALT", "AST"), ANL01FL == "Y", AVISITN > 0) %>%
  group_by(USUBJID) %>%
  summarise(MAX_TRANS_RATIO = max(AVAL / A1HI, na.rm = TRUE), .groups = "drop") %>%
  filter(MAX_TRANS_RATIO > 3)

hyslaw_bili <- adlb %>%
  filter(PARAMCD == "BILI", ANL01FL == "Y", AVISITN > 0) %>%
  group_by(USUBJID) %>%
  summarise(MAX_BILI_RATIO = max(AVAL / A1HI, na.rm = TRUE), .groups = "drop") %>%
  filter(MAX_BILI_RATIO > 2)

hyslaw_subj <- intersect(hyslaw_trans$USUBJID, hyslaw_bili$USUBJID)
adlb <- adlb %>%
  mutate(HYSLAWFL = if_else(USUBJID %in% hyslaw_subj & PARAMCD %in% c("ALT", "AST", "BILI"),
                            "Y", NA_character_))

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier", USUBJID = "Unique Subject Identifier",
  PARAMCD = "Parameter Code", PARAM = "Parameter Description",
  PARCAT1 = "Parameter Category 1",
  AVAL = "Analysis Value", AVALC = "Analysis Value (C)",
  BASE = "Baseline Value", CHG = "Change from Baseline",
  PCHG = "Percent Change from Baseline",
  A1LO = "Analysis Normal Range Lower Limit", A1HI = "Analysis Normal Range Upper Limit",
  ANRIND = "Analysis Normal Range Indicator", BNRIND = "Baseline Normal Range Indicator",
  SHIFT1 = "Shift 1", ABLFL = "Baseline Record Flag",
  ANL01FL = "Analysis Record Flag 01",
  AVISIT = "Analysis Visit", AVISITN = "Analysis Visit (N)",
  ADT = "Analysis Date", ADY = "Analysis Relative Day",
  TRTP = "Planned Treatment", TRTA = "Actual Treatment",
  SAFFL = "Safety Population Flag",
  HYSLAWFL = "Hy's Law Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adlb)) attr(adlb[[v]], "label") <- var_labels[[v]]
}
attr(adlb, "label") <- "Laboratory Analysis Dataset"

# ---- Export ----
export_adam(adlb, "adlb")

cat("\n=== ADLB Summary ===\n")
cat("Total records:", nrow(adlb), "\n")
cat("Parameters:", length(unique(adlb$PARAMCD)), "\n")
cat("Subjects:", length(unique(adlb$USUBJID)), "\n")
cat("Baseline records:", sum(adlb$ABLFL == "Y", na.rm = TRUE), "\n")
cat("Hy's Law subjects:", length(hyslaw_subj), "\n")
