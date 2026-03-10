# ============================================================================
# Name: 02_adae.R
# Description: Create ADAE (Adverse Event Analysis Dataset)
# Source SDTM: AE, SUPPAE, ADSL
# Supports TLGs: T-18, T-19, F-1
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
ae     <- read_sdtm("ae")
suppae <- read_sdtm("suppae")
adsl   <- read_adam("adsl")

# Convert ADSL date columns back to Date type
adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN),
    TRT01AN = as.numeric(TRT01AN),
    AGE = as.numeric(AGE)
  )

# ---- Merge supplemental qualifiers ----
ae <- combine_supp(ae, suppae)

# ---- Build ADAE ----
adae <- ae %>%
  # Derive analysis dates
  mutate(
    ASTDT = as.Date(substr(AESTDTC, 1, 10)),
    AENDT = as.Date(substr(AEENDTC, 1, 10))
  ) %>%
  # Merge ADSL variables
  left_join(
    adsl %>% select(STUDYID, USUBJID, SITEID, TRT01P, TRT01A, TRT01PN, TRT01AN,
                     TRTSDT, TRTEDT, AGE, AGEGR1, SEX, RACE, SAFFL, ITTFL, EFFFL),
    by = c("STUDYID", "USUBJID")
  ) %>%
  # Treatment variables for BDS convention
  mutate(
    TRTP = TRT01P,
    TRTA = TRT01A,
    TRTPN = TRT01PN,
    TRTAN = TRT01AN
  ) %>%
  # TEAE flag: AE start on or after first dose
  mutate(
    TRTEMFL = case_when(
      !is.na(ASTDT) & !is.na(TRTSDT) & ASTDT >= TRTSDT ~ "Y",
      is.na(ASTDT) & !is.na(AENDT) & !is.na(TRTSDT) & AENDT >= TRTSDT ~ "Y",
      TRUE ~ NA_character_
    )
  ) %>%
  # Study day
  mutate(
    ASTDY = case_when(
      !is.na(ASTDT) & !is.na(TRTSDT) & ASTDT >= TRTSDT ~ as.numeric(ASTDT - TRTSDT) + 1,
      !is.na(ASTDT) & !is.na(TRTSDT) & ASTDT < TRTSDT ~ as.numeric(ASTDT - TRTSDT),
      TRUE ~ NA_real_
    ),
    AENDY = case_when(
      !is.na(AENDT) & !is.na(TRTSDT) & AENDT >= TRTSDT ~ as.numeric(AENDT - TRTSDT) + 1,
      !is.na(AENDT) & !is.na(TRTSDT) & AENDT < TRTSDT ~ as.numeric(AENDT - TRTSDT),
      TRUE ~ NA_real_
    )
  ) %>%
  # Severity numeric
  mutate(
    AESEVN = case_when(
      AESEV == "MILD" ~ 1,
      AESEV == "MODERATE" ~ 2,
      AESEV == "SEVERE" ~ 3,
      TRUE ~ NA_real_
    )
  ) %>%
  # AE sequence
  mutate(AESEQ = as.numeric(AESEQ)) %>%
  # Dermatological events custom query (for ADTTE/F-1)
  mutate(
    CQ01NAM = case_when(
      str_detect(toupper(AEBODSYS), "SKIN|DERMAT") |
        str_detect(toupper(AEDECOD), "RASH|PRURITUS|DERMATITIS|ERYTHEMA|URTICARIA|SKIN") ~
        "DERMATOLOGICAL EVENTS",
      TRUE ~ NA_character_
    )
  )

# ---- First occurrence flags (within TEAEs only) ----
adae_teae <- adae %>% filter(TRTEMFL == "Y")

# First occurrence within subject (any TEAE)
aocc_any <- adae_teae %>%
  group_by(USUBJID) %>%
  slice_min(order_by = tibble(ASTDT, AESEQ), n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  mutate(AOCCFL = "Y") %>%
  select(STUDYID, USUBJID, DOMAIN, AESEQ, AOCCFL)

# First occurrence within SOC
aocc_soc <- adae_teae %>%
  group_by(USUBJID, AEBODSYS) %>%
  slice_min(order_by = tibble(ASTDT, AESEQ), n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  mutate(AOCCSFL = "Y") %>%
  select(STUDYID, USUBJID, DOMAIN, AESEQ, AEBODSYS, AOCCSFL)

# First occurrence within SOC/PT
aocc_pt <- adae_teae %>%
  group_by(USUBJID, AEBODSYS, AEDECOD) %>%
  slice_min(order_by = tibble(ASTDT, AESEQ), n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  mutate(AOCCPFL = "Y") %>%
  select(STUDYID, USUBJID, DOMAIN, AESEQ, AEBODSYS, AEDECOD, AOCCPFL)

adae <- adae %>%
  left_join(aocc_any, by = c("STUDYID", "USUBJID", "DOMAIN", "AESEQ")) %>%
  left_join(aocc_soc, by = c("STUDYID", "USUBJID", "DOMAIN", "AESEQ", "AEBODSYS")) %>%
  left_join(aocc_pt, by = c("STUDYID", "USUBJID", "DOMAIN", "AESEQ", "AEBODSYS", "AEDECOD"))

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier", USUBJID = "Unique Subject Identifier",
  AETERM = "Reported Term for the Adverse Event",
  AEDECOD = "Dictionary-Derived Term", AEBODSYS = "Body System or Organ Class",
  AESEV = "Severity/Intensity", AESEVN = "Severity/Intensity (N)",
  AESER = "Serious Event", AEREL = "Causality",
  AEACN = "Action Taken with Study Treatment", AEOUT = "Outcome of Adverse Event",
  ASTDT = "Analysis Start Date", AENDT = "Analysis End Date",
  ASTDY = "Analysis Start Relative Day", AENDY = "Analysis End Relative Day",
  TRTEMFL = "Treatment Emergent Analysis Flag",
  TRTP = "Planned Treatment", TRTA = "Actual Treatment",
  CQ01NAM = "Customized Query 01 Name",
  AOCCFL = "1st Occurrence of Any AE Flag",
  AOCCSFL = "1st Occurrence of SOC Flag",
  AOCCPFL = "1st Occurrence of Preferred Term Flag",
  SAFFL = "Safety Population Flag", ITTFL = "Intent-to-Treat Population Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adae)) attr(adae[[v]], "label") <- var_labels[[v]]
}
attr(adae, "label") <- "Adverse Event Analysis Dataset"

# ---- Export ----
export_adam(adae, "adae")

cat("\n=== ADAE Summary ===\n")
cat("Total AE records:", nrow(adae), "\n")
cat("TEAEs:", sum(adae$TRTEMFL == "Y", na.rm = TRUE), "\n")
cat("Serious TEAEs:", sum(adae$TRTEMFL == "Y" & adae$AESER == "Y", na.rm = TRUE), "\n")
cat("Dermatological events:", sum(!is.na(adae$CQ01NAM), na.rm = TRUE), "\n")
cat("Unique subjects with TEAEs:", length(unique(adae$USUBJID[adae$TRTEMFL == "Y"])), "\n")
