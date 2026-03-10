# ============================================================================
# Name: 09_adcm.R
# Description: Create ADCM (Concomitant Medication Analysis Dataset)
# Source SDTM: CM, ADSL
# Supports TLGs: T-29
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source data ----
cm   <- read_sdtm("cm")
adsl <- read_adam("adsl")

adsl <- adsl %>%
  mutate(
    TRTSDT = as.Date(TRTSDT),
    TRTEDT = as.Date(TRTEDT),
    TRT01PN = as.numeric(TRT01PN)
  )

# ---- Build ADCM ----
adcm <- cm %>%
  mutate(
    ASTDT = suppressWarnings(as.Date(
      if_else(nchar(CMSTDTC) >= 10,
              substr(CMSTDTC, 1, 10), NA_character_)
    )),
    AENDT = suppressWarnings(as.Date(
      if_else(nchar(CMENDTC) >= 10,
              substr(CMENDTC, 1, 10), NA_character_)
    ))
  ) %>%
  # Merge ADSL
  left_join(
    adsl %>% select(
      STUDYID, USUBJID, SITEID,
      TRT01P, TRT01A, TRT01PN,
      TRTSDT, TRTEDT, SAFFL, ITTFL
    ),
    by = c("STUDYID", "USUBJID")
  ) %>%
  mutate(
    TRTP = TRT01P,
    TRTA = TRT01A
  ) %>%
  # Classification flags
  mutate(
    # Concomitant: overlaps with treatment period
    CONCOMFL = case_when(
      !is.na(TRTSDT) & (
        (is.na(ASTDT) & is.na(AENDT)) |
        (!is.na(ASTDT) & !is.na(TRTEDT) &
          ASTDT <= TRTEDT &
          (is.na(AENDT) | AENDT >= TRTSDT)) |
        (!is.na(AENDT) & AENDT >= TRTSDT &
          (is.na(ASTDT) | ASTDT <= TRTEDT))
      ) ~ "Y",
      TRUE ~ NA_character_
    ),
    # Prior: started before first dose
    PREFL = case_when(
      !is.na(ASTDT) & !is.na(TRTSDT) &
        ASTDT < TRTSDT ~ "Y",
      TRUE ~ NA_character_
    ),
    # On treatment
    ONTRTFL = case_when(
      !is.na(ASTDT) & !is.na(TRTSDT) &
        ASTDT >= TRTSDT ~ "Y",
      !is.na(ASTDT) & !is.na(TRTSDT) &
        ASTDT < TRTSDT &
        (is.na(AENDT) | AENDT >= TRTSDT) ~ "Y",
      TRUE ~ NA_character_
    )
  ) %>%
  # Study day
  mutate(
    ASTDY = case_when(
      !is.na(ASTDT) & !is.na(TRTSDT) &
        ASTDT >= TRTSDT ~
        as.numeric(ASTDT - TRTSDT) + 1,
      !is.na(ASTDT) & !is.na(TRTSDT) &
        ASTDT < TRTSDT ~
        as.numeric(ASTDT - TRTSDT),
      TRUE ~ NA_real_
    )
  )

# ---- Select and order variables ----
adcm <- adcm %>%
  select(
    STUDYID, USUBJID, SITEID,
    TRT01P, TRT01A, TRT01PN, TRTP, TRTA,
    TRTSDT, TRTEDT, SAFFL, ITTFL,
    CMTRT, CMDECOD, CMCLAS, CMINDC,
    CMDOSE, CMDOSU, CMDOSFRQ, CMROUTE,
    ASTDT, AENDT, ASTDY,
    CONCOMFL, PREFL, ONTRTFL
  )

# ---- Assign labels ----
var_labels <- c(
  CMTRT = "Reported Name of Drug, Med, or Therapy",
  CMDECOD = "Standardized Medication Name",
  CMCLAS = "Medication Class",
  CMINDC = "Indication",
  ASTDT = "Analysis Start Date",
  AENDT = "Analysis End Date",
  ASTDY = "Analysis Start Relative Day",
  CONCOMFL = "Concomitant Medication Flag",
  PREFL = "Prior Medication Flag",
  ONTRTFL = "On Treatment Flag"
)
for (v in names(var_labels)) {
  if (v %in% names(adcm)) {
    attr(adcm[[v]], "label") <- var_labels[[v]]
  }
}
attr(adcm, "label") <- "Concomitant Medication Analysis Dataset"

# ---- Export ----
export_adam(adcm, "adcm")

cat("\n=== ADCM Summary ===\n")
cat("Total records:", nrow(adcm), "\n")
cat("Subjects:", length(unique(adcm$USUBJID)), "\n")
cat("Concomitant meds:", sum(adcm$CONCOMFL == "Y", na.rm = TRUE), "\n")
cat("Unique medications:", length(unique(adcm$CMDECOD)), "\n")
