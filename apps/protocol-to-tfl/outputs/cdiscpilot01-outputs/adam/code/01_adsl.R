# ============================================================================
# Name: 01_adsl.R
# Description: Create ADSL (Subject-Level Analysis Dataset)
# Source SDTM: DM, DS, EX, SV, SC, MH, QS, SUPPDM
# Supports TLGs: T-1, T-2, T-3, T-4
# ============================================================================

source("/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/code/00_setup.R")

# ---- Read source SDTM ----
dm     <- read_sdtm("dm")
ds     <- read_sdtm("ds")
ex     <- read_sdtm("ex")
sv     <- read_sdtm("sv")
sc     <- read_sdtm("sc")
mh     <- read_sdtm("mh")
qs     <- read_sdtm("qs")
suppdm <- read_sdtm("suppdm")

# ---- Derive treatment dates from EX ----
ex_dates <- ex %>%
  mutate(
    EXSTDT = as.Date(substr(EXSTDTC, 1, 10)),
    EXENDT = as.Date(substr(EXENDTC, 1, 10))
  ) %>%
  group_by(STUDYID, USUBJID) %>%
  summarise(
    TRTSDT = min(EXSTDT, na.rm = TRUE),
    TRTEDT = max(EXENDT, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    TRTSDT = if_else(is.infinite(TRTSDT), NA_Date_, TRTSDT),
    TRTEDT = if_else(is.infinite(TRTEDT), NA_Date_, TRTEDT)
  )

# ---- Derive disposition from DS ----
ds_disp <- ds %>%
  filter(DSCAT == "DISPOSITION EVENT") %>%
  mutate(
    EOSSTT = case_when(
      DSDECOD == "COMPLETED" ~ "COMPLETED",
      TRUE ~ "DISCONTINUED"
    ),
    DCSREAS = if_else(DSDECOD != "COMPLETED", DSDECOD, NA_character_),
    DISDT = as.Date(substr(DSSTDTC, 1, 10))
  ) %>%
  select(STUDYID, USUBJID, EOSSTT, DCSREAS, DISDT)

# ---- Derive education from SC ----
sc_edu <- sc %>%
  filter(SCTESTCD == "EDLEVEL") %>%
  mutate(EDUCLVL = as.numeric(SCSTRESN)) %>%
  select(STUDYID, USUBJID, EDUCLVL)

# ---- Derive MMSE baseline from QS ----
qs_mmse <- qs %>%
  filter(QSCAT == "MINI-MENTAL STATE", QSBLFL == "Y", QSTESTCD == "MMSEITM") %>%
  # MMSE total is a derived score; if MMSEITM not found, look for derived total
  bind_rows(
    qs %>% filter(QSCAT == "MINI-MENTAL STATE", QSBLFL == "Y", QSDRVFL == "Y")
  ) %>%
  # If there's a derived total, use it; otherwise sum items
  group_by(STUDYID, USUBJID) %>%
  filter(row_number() == 1) %>%  # Take first matching
  ungroup() %>%
  mutate(MMSETOT = as.numeric(QSSTRESN)) %>%
  select(STUDYID, USUBJID, MMSETOT)

# Actually, MMSE total might be scored differently; let's derive from items
# The MMSE total is the sum of all individual item scores at baseline
qs_mmse <- qs %>%
  filter(QSCAT == "MINI-MENTAL STATE", QSBLFL == "Y", QSDRVFL != "Y" | is.na(QSDRVFL)) %>%
  group_by(STUDYID, USUBJID) %>%
  summarise(MMSETOT = sum(as.numeric(QSSTRESN), na.rm = TRUE), .groups = "drop")

# ---- Derive disease onset date from MH ----
mh_onset <- mh %>%
  filter(MHCAT == "PRIMARY DIAGNOSIS" | str_detect(toupper(MHTERM), "ALZHEIMER")) %>%
  mutate(DISONSDT = as.Date(substr(MHSTDTC, 1, 10))) %>%
  filter(!is.na(DISONSDT)) %>%
  group_by(STUDYID, USUBJID) %>%
  slice_min(DISONSDT, n = 1) %>%
  ungroup() %>%
  select(STUDYID, USUBJID, DISONSDT) %>%
  distinct()

# ---- Get population flags from SUPPDM ----
pop_flags <- suppdm %>%
  filter(QNAM %in% c("ITT", "SAFETY", "EFFICACY", "COMPLT8", "COMPLT16", "COMPLT24")) %>%
  select(STUDYID, USUBJID, QNAM, QVAL) %>%
  pivot_wider(names_from = QNAM, values_from = QVAL) %>%
  rename_with(~ case_when(
    .x == "ITT" ~ "ITTFL",
    .x == "SAFETY" ~ "SAFFL",
    .x == "EFFICACY" ~ "EFFFL",
    .x == "COMPLT8" ~ "COMP8FL",
    .x == "COMPLT16" ~ "COMP16FL",
    .x == "COMPLT24" ~ "COMP24FL",
    TRUE ~ .x
  ))

# ---- Derive visit 1 date (screening/Week -2) from SV ----
sv_visit1 <- sv %>%
  filter(VISITNUM == 1) %>%
  mutate(VISIT1DT = as.Date(substr(SVSTDTC, 1, 10))) %>%
  select(STUDYID, USUBJID, VISIT1DT)

# ---- Derive baseline weight and height from VS ----
# (Need to read VS for baseline weight/height)
vs <- read_sdtm("vs")

vs_weight_bl <- vs %>%
  filter(VSTESTCD == "WEIGHT", VSBLFL == "Y") %>%
  mutate(WEIGHTBL = as.numeric(VSSTRESN)) %>%
  group_by(STUDYID, USUBJID) %>%
  slice(1) %>%
  ungroup() %>%
  select(STUDYID, USUBJID, WEIGHTBL)

vs_height_bl <- vs %>%
  filter(VSTESTCD == "HEIGHT", VSBLFL == "Y") %>%
  mutate(HEIGHTBL = as.numeric(VSSTRESN)) %>%
  group_by(STUDYID, USUBJID) %>%
  slice(1) %>%
  ungroup() %>%
  select(STUDYID, USUBJID, HEIGHTBL)

# ---- Build ADSL ----
adsl <- dm %>%
  select(STUDYID, USUBJID, SUBJID, SITEID, AGE, AGEU, SEX, RACE, ETHNIC,
         ARM, ARMCD, ACTARM, ACTARMCD, RFSTDTC, RFENDTC, DTHDTC, DTHFL, COUNTRY) %>%
  mutate(
    TRT01P  = ARM,
    TRT01A  = ACTARM,
    TRT01PN = case_when(
      ARM == "Placebo" ~ 0,
      ARM == "Xanomeline Low Dose" ~ 1,
      ARM == "Xanomeline High Dose" ~ 2,
      TRUE ~ NA_real_
    ),
    TRT01AN = case_when(
      ACTARM == "Placebo" ~ 0,
      ACTARM == "Xanomeline Low Dose" ~ 1,
      ACTARM == "Xanomeline High Dose" ~ 2,
      TRUE ~ NA_real_
    )
  ) %>%
  # Age group
  mutate(
    AGE = as.numeric(AGE),
    AGEGR1 = case_when(
      AGE < 65 ~ "<65",
      AGE >= 65 & AGE <= 80 ~ "65-80",
      AGE > 80 ~ ">80",
      TRUE ~ NA_character_
    ),
    AGEGR1N = case_when(
      AGEGR1 == "<65" ~ 1,
      AGEGR1 == "65-80" ~ 2,
      AGEGR1 == ">80" ~ 3,
      TRUE ~ NA_real_
    )
  ) %>%
  # Race numeric
  mutate(
    RACEN = case_when(
      RACE == "WHITE" ~ 1,
      RACE == "BLACK OR AFRICAN AMERICAN" ~ 2,
      RACE == "AMERICAN INDIAN OR ALASKA NATIVE" ~ 6,
      TRUE ~ NA_real_
    )
  ) %>%
  # Join treatment dates
  left_join(ex_dates, by = c("STUDYID", "USUBJID")) %>%
  # Treatment duration
  mutate(TRTDUR = as.numeric(TRTEDT - TRTSDT) + 1) %>%
  # Join disposition
  left_join(ds_disp, by = c("STUDYID", "USUBJID")) %>%
  # Join population flags
  left_join(pop_flags, by = c("STUDYID", "USUBJID")) %>%
  # Set flags to N where missing for ITT/SAFFL/EFFFL
  mutate(
    ITTFL    = if_else(is.na(ITTFL), "N", ITTFL),
    SAFFL    = if_else(is.na(SAFFL), "N", SAFFL),
    EFFFL    = if_else(is.na(EFFFL), "N", EFFFL),
    COMP8FL  = if_else(is.na(COMP8FL), "N", COMP8FL),
    COMP16FL = if_else(is.na(COMP16FL), "N", COMP16FL),
    COMP24FL = if_else(is.na(COMP24FL), "N", COMP24FL)
  ) %>%
  # Join education
  left_join(sc_edu, by = c("STUDYID", "USUBJID")) %>%
  # Join MMSE
  left_join(qs_mmse, by = c("STUDYID", "USUBJID")) %>%
  # Join disease onset
  left_join(mh_onset, by = c("STUDYID", "USUBJID")) %>%
  # Join visit 1 date
  left_join(sv_visit1, by = c("STUDYID", "USUBJID")) %>%
  # Duration of disease (months)
  mutate(
    DURDIS = as.numeric(difftime(VISIT1DT, DISONSDT, units = "days")) / 30.4375,
    DURDSGR1 = case_when(
      DURDIS < 12 ~ "<12",
      TRUE ~ ">=12"
    )
  ) %>%
  # Join baseline weight/height
  left_join(vs_weight_bl, by = c("STUDYID", "USUBJID")) %>%
  left_join(vs_height_bl, by = c("STUDYID", "USUBJID")) %>%
  # Derive BMI
  mutate(
    BMIBL = round(WEIGHTBL / (HEIGHTBL / 100)^2, 1),
    BMIBLGR1 = case_when(
      BMIBL < 25 ~ "<25",
      BMIBL >= 25 & BMIBL < 30 ~ "25-<30",
      BMIBL >= 30 ~ ">=30",
      TRUE ~ NA_character_
    )
  ) %>%
  # Death date and flag
  mutate(
    DTHDT = as.Date(substr(DTHDTC, 1, 10)),
    DTHFL = if_else(!is.na(DTHDT) | DTHFL == "Y", "Y", NA_character_)
  ) %>%
  # Site pooling (pool sites with < 3 subjects in any arm)
  group_by(SITEID) %>%
  mutate(SITE_N = n()) %>%
  ungroup() %>%
  mutate(SITEGR1 = if_else(SITE_N >= 3, SITEID, "900")) %>%
  select(-SITE_N, -VISIT1DT)

# ---- Assign labels ----
var_labels <- c(
  STUDYID = "Study Identifier", USUBJID = "Unique Subject Identifier",
  SUBJID = "Subject Identifier for the Study", SITEID = "Study Site Identifier",
  SITEGR1 = "Pooled Analysis Site Group 1",
  AGE = "Age", AGEU = "Age Units", AGEGR1 = "Pooled Age Group 1", AGEGR1N = "Pooled Age Group 1 (N)",
  SEX = "Sex", RACE = "Race", RACEN = "Race (N)", ETHNIC = "Ethnicity",
  ARM = "Description of Planned Arm", ARMCD = "Planned Arm Code",
  ACTARM = "Description of Actual Arm", ACTARMCD = "Actual Arm Code",
  TRT01P = "Planned Treatment for Period 01", TRT01A = "Actual Treatment for Period 01",
  TRT01PN = "Planned Treatment for Period 01 (N)", TRT01AN = "Actual Treatment for Period 01 (N)",
  TRTSDT = "Date of First Exposure to Treatment",
  TRTEDT = "Date of Last Exposure to Treatment",
  TRTDUR = "Duration of Treatment (days)",
  RFSTDTC = "Subject Reference Start Date/Time",
  RFENDTC = "Subject Reference End Date/Time",
  EOSSTT = "End of Study Status", DCSREAS = "Reason for Discontinuation",
  DISDT = "Date of Disposition Event",
  DTHDT = "Date of Death", DTHFL = "Subject Death Flag",
  ITTFL = "Intent-to-Treat Population Flag", SAFFL = "Safety Population Flag",
  EFFFL = "Efficacy Population Flag",
  COMP8FL = "Completers of Week 8 Population Flag",
  COMP16FL = "Completers of Week 16 Population Flag",
  COMP24FL = "Completers of Week 24 Population Flag",
  EDUCLVL = "Years of Education", MMSETOT = "MMSE Total Score at Baseline",
  DISONSDT = "Date of Onset of Disease", DURDIS = "Duration of Disease (months)",
  DURDSGR1 = "Duration of Disease Group 1",
  WEIGHTBL = "Baseline Weight (kg)", HEIGHTBL = "Baseline Height (cm)",
  BMIBL = "Baseline BMI (kg/m2)", BMIBLGR1 = "Baseline BMI Group 1",
  COUNTRY = "Country", DTHDTC = "Date/Time of Death"
)
for (v in names(var_labels)) {
  if (v %in% names(adsl)) attr(adsl[[v]], "label") <- var_labels[[v]]
}
attr(adsl, "label") <- "Subject-Level Analysis Dataset"

# ---- Export ----
export_adam(adsl, "adsl")

# ---- Summary ----
cat("\n=== ADSL Summary ===\n")
cat("Total subjects:", nrow(adsl), "\n")
cat("Arms:", paste(sort(unique(adsl$TRT01P)), collapse = " | "), "\n")
cat("ITTFL=Y:", sum(adsl$ITTFL == "Y"), "\n")
cat("SAFFL=Y:", sum(adsl$SAFFL == "Y"), "\n")
cat("EFFFL=Y:", sum(adsl$EFFFL == "Y"), "\n")
cat("COMP24FL=Y:", sum(adsl$COMP24FL == "Y"), "\n")
