# ADaM Dataset Guide

This reference describes standard ADaM dataset structures, their source SDTM domains, key variables, and common derivation patterns. Use this when planning which ADaM datasets to create and how to derive them.

## ADaM Fundamentals

### Dataset classes

| Class | Structure | Examples |
|-------|-----------|----------|
| ADSL (Subject-Level) | One row per subject | ADSL |
| BDS (Basic Data Structure) | One row per subject per parameter per analysis timepoint | ADLB, ADVS, ADEG, ADQS, ADEX |
| OCCDS (Occurrence Data Structure) | One row per subject per event/intervention record | ADAE, ADCM, ADMH |
| ADTTE (Time-to-Event) | One row per subject per TTE parameter | ADTTE |

### Required variables (all ADaM datasets)

| Variable | Label | Type | Notes |
|----------|-------|------|-------|
| STUDYID | Study Identifier | Char | From SDTM |
| USUBJID | Unique Subject Identifier | Char | From SDTM |
| SITEID | Study Site Identifier | Char | From DM |

### Required variables (BDS datasets)

| Variable | Label | Type | Notes |
|----------|-------|------|-------|
| PARAMCD | Parameter Code | Char | Short code, max 8 chars |
| PARAM | Parameter | Char | Full descriptive label |
| PARAMN | Parameter (N) | Num | Numeric code for sorting |
| AVAL | Analysis Value | Num | Numeric analysis value |
| AVALC | Analysis Value (C) | Char | Character analysis value (if applicable) |
| BASE | Baseline Value | Num | Value at baseline |
| CHG | Change from Baseline | Num | AVAL - BASE |
| AVISIT | Analysis Visit | Char | Analysis visit label |
| AVISITN | Analysis Visit (N) | Num | Numeric visit for sorting |
| ANL01FL | Analysis Record Flag 01 | Char | Y/null — flags records used in primary analysis |
| DTYPE | Derivation Type | Char | e.g., "LOCF", "WOCF", "AVERAGE" for derived records |

---

## ADSL — Subject-Level Analysis Dataset

### Purpose
One row per subject containing demographics, treatment information, population flags, and key dates. Every other ADaM dataset merges from ADSL.

### Source SDTM domains
- **DM** (primary) — demographics, arm, dates
- **DS** — disposition (completion status, reasons)
- **EX** — exposure (first/last dose dates)
- **SV** — subject visits (for date derivations)
- **SC** — subject characteristics (if available)
- **SUPPDM** — supplemental demographics
- **SUPPDS** — supplemental disposition
- **MH** — medical history (for disease duration derivations)
- **QS** — questionnaires (for baseline scores if needed for population flags)

### Key variables

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| USUBJID | Unique Subject ID | DM.USUBJID |
| SUBJID | Subject ID | DM.SUBJID |
| SITEID | Site ID | DM.SITEID |
| SITEGR1 | Pooled Site Group | Derived: pool small sites per SAP rules |
| AGE | Age | DM.AGE |
| AGEGR1 | Age Group 1 | Derived from AGE (e.g., "<65", "65-80", ">80") |
| AGEGR1N | Age Group 1 (N) | Numeric code for AGEGR1 |
| SEX | Sex | DM.SEX |
| RACE | Race | DM.RACE |
| RACEN | Race (N) | Numeric code for RACE |
| ETHNIC | Ethnicity | DM.ETHNIC |
| ARM | Planned Treatment Arm | DM.ARM |
| TRT01P | Planned Treatment for Period 01 | DM.ARM |
| TRT01PN | Planned Treatment (N) | Numeric code for TRT01P |
| TRT01A | Actual Treatment for Period 01 | DM.ACTARM (or EX-derived) |
| TRT01AN | Actual Treatment (N) | Numeric code for TRT01A |
| TRTSDT | Date of First Exposure | Earliest EX.EXSTDTC |
| TRTEDT | Date of Last Exposure | Latest EX.EXENDTC |
| TRTDUR | Duration of Treatment (days) | TRTEDT - TRTSDT + 1 |
| RFSTDTC | Reference Start Date/Time | DM.RFSTDTC |
| RFENDTC | Reference End Date/Time | DM.RFENDTC |
| RANDDT | Date of Randomization | DM.RFSTDTC or DS randomization record |
| EOSSTT | End of Study Status | DS.DSDECOD (COMPLETED/DISCONTINUED) |
| DCSREAS | Reason for Discontinuation | DS.DSTERM where DSCAT=DISPOSITION |
| DTHDT | Date of Death | DM.DTHDTC or AE/DS death records |
| DTHFL | Death Flag | "Y" if subject died, null otherwise |
| SAFFL | Safety Population Flag | Y if took >= 1 dose of study drug |
| ITTFL | Intent-to-Treat Flag | Y if randomized |
| EFFFL | Efficacy Population Flag | Study-specific criteria (often SAFFL=Y + baseline + post-baseline assessment) |
| COMP24FL | Completers at Week 24 Flag | Y if completed Week 24 visit |
| WEIGHTBL | Baseline Weight | VS weight at baseline visit |
| HEIGHTBL | Baseline Height | VS height at screening |
| BMIBL | Baseline BMI | Derived: WEIGHTBL / (HEIGHTBL/100)^2 |
| BMIBLGR1 | Baseline BMI Group | Derived from BMIBL |
| EDUCLVL | Years of Education | SC or SUPPDM |
| MMSETOT | Baseline MMSE Total Score | QS MMSE at baseline |
| DISONSDT | Date of Disease Onset | MH date of first symptoms |
| DURDIS | Duration of Disease (months) | Derived from DISONSDT to reference date |
| DURDSGR1 | Duration of Disease Group | Derived from DURDIS |

### Admiral derivation pattern

```r
adsl <- dm %>%
  # Derive treatment variables
  mutate(
    TRT01P = ARM,
    TRT01A = ACTARM
  ) %>%
  # Derive treatment start/end dates from EX
  derive_vars_merged_dt(
    dataset_add = ex,
    by_vars = exprs(STUDYID, USUBJID),
    new_vars_prefix = "TRTS",
    dtc = EXSTDTC,
    mode = "first"
  ) %>%
  derive_vars_merged_dt(
    dataset_add = ex,
    by_vars = exprs(STUDYID, USUBJID),
    new_vars_prefix = "TRTE",
    dtc = EXENDTC,
    mode = "last"
  ) %>%
  # Derive disposition
  derive_vars_disposition_reason(
    dataset_ds = ds,
    new_var = DCSREAS,
    reason_var = DSTERM
  ) %>%
  # Derive population flags
  mutate(
    SAFFL = if_else(!is.na(TRTSDT), "Y", "N"),
    ITTFL = if_else(!is.na(ARM), "Y", "N")
  )
```

---

## ADAE — Adverse Event Analysis Dataset

### Purpose
One row per adverse event record per subject. Supports AE summary tables, SOC/PT incidence tables, SAE tables.

### Source SDTM domains
- **AE** (primary)
- **ADSL** (for treatment dates, population flags)
- **SUPPAE** (supplemental AE qualifiers)
- **EX** (for TEAE determination)

### Key variables

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| USUBJID | Unique Subject ID | AE.USUBJID |
| AETERM | Reported AE Term | AE.AETERM |
| AEDECOD | Dictionary-Derived Term | AE.AEDECOD (MedDRA PT) |
| AEBODSYS | Body System or Organ Class | AE.AEBODSYS (MedDRA SOC) |
| AESEV | Severity | AE.AESEV |
| AESER | Serious Event | AE.AESER |
| AEREL | Causality | AE.AEREL |
| AEACN | Action Taken | AE.AEACN |
| AEOUT | Outcome | AE.AEOUT |
| ASTDT | Analysis Start Date | Imputed from AE.AESTDTC |
| AENDT | Analysis End Date | Imputed from AE.AEENDTC |
| ASTDY | Analysis Start Day | ASTDT - TRTSDT + 1 (if ASTDT >= TRTSDT) |
| TRTEMFL | Treatment Emergent Flag | Y if ASTDT >= TRTSDT |
| AESEVN | Severity (N) | 1=MILD, 2=MODERATE, 3=SEVERE |
| AETOXGR | Toxicity Grade | AE.AETOXGR (CTCAE grade if coded) |
| CQ01NAM | Customized Query 01 Name | Derived: e.g., "Dermatological Events" |
| AOCCFL | 1st Occurrence within SOC Flag | Derived |
| AOCCSFL | 1st Occurrence within SOC/PT Flag | Derived |
| AOCCPFL | 1st Occurrence of PT Flag | Derived |

### TEAE determination logic
An AE is treatment-emergent if:
- AE start date >= date of first dose (TRTSDT from ADSL)
- OR AE start date is missing and AE end date >= date of first dose
- Some studies also exclude AEs starting > 30 days after last dose

### Admiral derivation pattern

```r
adae <- ae %>%
  # Derive analysis dates
  derive_vars_dt(new_vars_prefix = "AST", dtc = AESTDTC) %>%
  derive_vars_dt(new_vars_prefix = "AEN", dtc = AEENDTC) %>%
  # Merge ADSL for treatment dates and population flags
  derive_vars_merged(
    dataset_add = adsl,
    by_vars = exprs(STUDYID, USUBJID),
    new_vars = exprs(TRTSDT, TRTEDT, TRT01P, TRT01A, SAFFL, ITTFL, AGE, SEX, RACE)
  ) %>%
  # Derive TEAE flag
  mutate(TRTEMFL = if_else(ASTDT >= TRTSDT | is.na(ASTDT), "Y", NA_character_)) %>%
  # Derive study day
  derive_vars_dy(reference_date = TRTSDT, source_vars = exprs(ASTDT, AENDT)) %>%
  # Derive occurrence flags (first occurrence within SOC, PT)
  restrict_derivation(
    derivation = derive_var_extreme_flag,
    args = params(
      by_vars = exprs(USUBJID, AEBODSYS),
      order = exprs(ASTDT, AESEQ),
      new_var = AOCCFL,
      mode = "first"
    ),
    filter = TRTEMFL == "Y"
  )
```

---

## ADLB — Laboratory Analysis Dataset

### Purpose
One row per subject per lab parameter per analysis visit. Supports lab summary tables, shift tables, abnormality tables, Hy's Law analysis.

### Source SDTM domains
- **LB** (primary)
- **ADSL** (treatment dates, population flags)
- **SUPPLB** (supplemental lab qualifiers)

### Key variables

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| PARAMCD | Parameter Code | LB.LBTESTCD |
| PARAM | Parameter | LB.LBTEST with units |
| AVAL | Analysis Value | LB.LBSTRESN (standardized numeric) |
| AVALC | Analysis Value (C) | LB.LBSTRESC |
| BASE | Baseline Value | AVAL at baseline visit |
| CHG | Change from Baseline | AVAL - BASE |
| PCHG | Percent Change | 100 * CHG / BASE |
| A1LO | Analysis Normal Range Low | LB.LBSTNRLO |
| A1HI | Analysis Normal Range High | LB.LBSTNRHI |
| ANRIND | Analysis Normal Range Indicator | Derived: "NORMAL", "LOW", "HIGH" |
| BNRIND | Baseline Normal Range Indicator | ANRIND at baseline |
| SHIFT1 | Shift from Baseline | e.g., "NORMAL to HIGH" |
| ABLFL | Baseline Record Flag | Y for baseline record |
| ANL01FL | Analysis Flag 01 | Y for records included in primary analysis |
| AVISIT | Analysis Visit | Derived from visit windowing |
| AVISITN | Analysis Visit (N) | Numeric visit |
| LBCAT | Lab Category | LB.LBCAT (HEMATOLOGY, CHEMISTRY, URINALYSIS) |
| PARCAT1 | Parameter Category 1 | LB.LBCAT |
| ATOXGR | Analysis Toxicity Grade | NCI CTCAE grade if applicable |
| BTOXGR | Baseline Toxicity Grade | ATOXGR at baseline |
| DTYPE | Derivation Type | For LOCF/derived records |

### Shift analysis derivation
```r
# After baseline and on-treatment records are identified:
adlb <- adlb %>%
  derive_var_shift(
    new_var = SHIFT1,
    from_var = BNRIND,
    to_var = ANRIND
  )
```

### Hy's Law derivation
Hy's Law criteria: ALT or AST > 3xULN AND Total Bilirubin > 2xULN
```r
# Create Hy's Law flag
adlb_hyslaw <- adlb %>%
  filter(PARAMCD %in% c("ALT", "AST", "BILI")) %>%
  mutate(
    HYSLAW_CRIT = case_when(
      PARAMCD %in% c("ALT", "AST") & AVAL > 3 * A1HI ~ "ABNORMAL",
      PARAMCD == "BILI" & AVAL > 2 * A1HI ~ "ABNORMAL",
      TRUE ~ "NORMAL"
    )
  )
```

---

## ADVS — Vital Signs Analysis Dataset

### Purpose
One row per subject per vital sign parameter per analysis visit. Supports vital sign summary tables and change from baseline analyses.

### Source SDTM domains
- **VS** (primary)
- **ADSL** (treatment dates, population flags)

### Key variables
Same BDS structure as ADLB, plus:

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| PARAMCD | Parameter Code | VS.VSTESTCD + position qualifier |
| PARAM | Parameter | VS.VSTEST + position + units |
| AVAL | Analysis Value | VS.VSSTRESN |
| ATPT | Analysis Timepoint | VS.VSTPT (e.g., "AFTER LYING DOWN FOR 5 MINUTES") |
| ATPTN | Analysis Timepoint (N) | Numeric timepoint |

### Position-specific parameters
Vital signs often have multiple positions (supine, standing). Create separate PARAMCDs:
- SYSBP_SUPINE, SYSBP_STAND1, SYSBP_STAND3
- DIABP_SUPINE, DIABP_STAND1, DIABP_STAND3
- HR_SUPINE, HR_STAND1, HR_STAND3
- WEIGHT, HEIGHT, TEMP

---

## ADEX — Exposure Analysis Dataset

### Purpose
One row per subject per exposure parameter. Supports drug exposure summary tables.

### Source SDTM domains
- **EX** (primary)
- **ADSL** (treatment dates, population flags)

### Key variables

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| PARAMCD | Parameter Code | e.g., "TRTDUR", "AVGDD", "CUMD" |
| PARAM | Parameter | "Treatment Duration (days)", "Average Daily Dose (mg)", etc. |
| AVAL | Analysis Value | Derived from EX records |

### Common derived parameters
- **TRTDUR**: Treatment duration = TRTEDT - TRTSDT + 1
- **AVGDD**: Average daily dose = total dose / TRTDUR
- **CUMD**: Cumulative dose = sum of all doses
- **DOSE**: Planned dose level

---

## ADQS — Questionnaire Analysis Dataset(s)

### Purpose
One row per subject per questionnaire parameter per analysis visit. For studies with multiple instruments, may be split into separate datasets (ADQSADAS, ADQSCIBC, ADQSNPIX) or combined as ADQS with PARAMCD distinguishing instruments.

### Source SDTM domains
- **QS** (primary)
- **ADSL** (treatment dates, population flags, baseline scores)

### Key variables (same BDS structure)

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| PARAMCD | Parameter Code | QS.QSTESTCD or derived composite |
| PARAM | Parameter | QS.QSTEST or composite label |
| AVAL | Analysis Value | QS.QSSTRESN |
| AVALC | Analysis Value (C) | QS.QSSTRESC (for categorical like CIBIC+) |
| QSCAT | QS Category | QS.QSCAT (instrument name) |

### LOCF imputation for questionnaires
```r
# LOCF: carry forward last non-missing observation
adqs_locf <- adqs %>%
  derive_locf_records(
    by_vars = exprs(STUDYID, USUBJID, PARAMCD),
    order = exprs(AVISITN, AVISIT),
    analysis_var = AVAL
  )
```

### Composite scores
For instruments like ADAS-Cog (11), the total score is typically already in QS as a composite. If individual item scores need to be summed:
```r
# Derive total score from items
adqs <- adqs %>%
  derive_summary_records(
    by_vars = exprs(STUDYID, USUBJID, AVISIT, AVISITN),
    filter_add = PARAMCD %in% c("ITEM01", "ITEM02", ...),
    set_values_to = exprs(
      AVAL = sum(AVAL, na.rm = TRUE),
      PARAMCD = "ACTOT",
      PARAM = "ADAS-Cog(11) Total Score"
    )
  )
```

### Windowed visits for questionnaires
Some analyses use assessment windows:
```r
# Define visit windows
windows <- tribble(
  ~AVISIT,    ~AVISITN, ~lower, ~upper,
  "Baseline",  0,        -14,    1,
  "Week 8",    8,        43,     71,
  "Week 16",  16,        99,    127,
  "Week 24",  24,       155,    183
)
```

---

## ADCM — Concomitant Medication Analysis Dataset

### Purpose
One row per concomitant medication record per subject. Supports concomitant medication summary tables.

### Source SDTM domains
- **CM** (primary)
- **ADSL** (treatment dates, population flags)

### Key variables

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| CMTRT | Reported Name | CM.CMTRT |
| CMDECOD | Standardized Name | CM.CMDECOD (WHO Drug preferred name) |
| CMCLAS | Medication Class | CM.CMCLAS (ATC class) |
| CMINDC | Indication | CM.CMINDC |
| ASTDT | Analysis Start Date | Imputed from CM.CMSTDTC |
| AENDT | Analysis End Date | Imputed from CM.CMENDTC |
| CONCOMFL | Concomitant Flag | Y if overlaps with treatment period |
| PREFL | Prior Medication Flag | Y if started before first dose |
| ONTRTFL | On Treatment Flag | Y if taken during treatment period |

---

## ADTTE — Time-to-Event Analysis Dataset

### Purpose
One row per subject per TTE parameter. Supports KM analyses, Cox regression, time-to-event summary tables.

### Source SDTM domains (varies by parameter)
- **ADSL** (for start date reference, death date, censoring)
- **ADAE** (for AE-based endpoints like time to first dermatological event)
- **DS** (for study completion/discontinuation)
- **RS** (response for oncology PFS/DOR — via admiralonco)

### Key variables

| Variable | Label | Source/Derivation |
|----------|-------|-------------------|
| PARAMCD | Parameter Code | e.g., "OS", "PFS", "TTDERM" |
| PARAM | Parameter | e.g., "Overall Survival", "Time to First Derm Event" |
| AVAL | Analysis Value | Time in days (or weeks/months per convention) |
| CNSR | Censor | 0 = event, 1 = censored |
| EVNTDESC | Event Description | What constitutes the event |
| CNSDTDSC | Censor Date Description | Why censored |
| STARTDT | Time-to-Event Origin | Usually TRTSDT or RANDDT |
| ADT | Analysis Date | Date of event or censoring |

### Admiral derivation pattern

```r
# Define event and censoring sources
ttderm_event <- event_source(
  dataset_name = "adae",
  filter = TRTEMFL == "Y" & CQ01NAM == "DERMATOLOGICAL EVENTS",
  date = ASTDT,
  set_values_to = exprs(
    EVNTDESC = "Dermatological Adverse Event",
    CNSR = 0
  )
)

ttderm_censor <- censor_source(
  dataset_name = "adsl",
  date = TRTEDT,
  set_values_to = exprs(
    EVNTDESC = "Censored at last treatment date",
    CNSDTDSC = "Last treatment date",
    CNSR = 1
  )
)

adtte <- derive_param_tte(
  dataset_adsl = adsl,
  start_date = TRTSDT,
  event_conditions = list(ttderm_event),
  censor_conditions = list(ttderm_censor),
  source_datasets = list(adae = adae, adsl = adsl),
  set_values_to = exprs(PARAMCD = "TTDERM", PARAM = "Time to First Dermatological Event")
)
```

### Common oncology TTE parameters (via admiralonco)

| PARAMCD | Parameter | Event | Censoring |
|---------|-----------|-------|-----------|
| OS | Overall Survival | Death from any cause | Last known alive date |
| PFS | Progression-Free Survival | Progression or death | Last adequate tumor assessment |
| DOR | Duration of Response | Progression or death (responders only) | Last adequate tumor assessment |
| TTR | Time to Response | First confirmed response | Last adequate tumor assessment |

---

## ADMH — Medical History Analysis Dataset

### Purpose
One row per medical history record per subject. Primarily used for baseline medical history tables.

### Source SDTM domains
- **MH** (primary)
- **ADSL** (population flags)

---

## ADaM Variable Naming Conventions

### Timing variables
- `--DT` suffix: Date variable (e.g., ASTDT, TRTSDT)
- `--DTM` suffix: Datetime variable (e.g., ASTDTM)
- `--DY` suffix: Study day (e.g., ASTDY)
- `--DUR` suffix: Duration (e.g., TRTDUR)

### Flag variables
- `--FL` suffix: Flag (values "Y" or null, never "N" in most conventions)
- Exception: SAFFL, ITTFL, EFFFL may use "Y"/"N" per sponsor convention

### Grouping variables
- `--GR1` suffix: Grouping version 1 (e.g., AGEGR1, SITEGR1)
- `--GR1N` suffix: Numeric version of grouping

### Treatment variables
- `TRT01P` / `TRT01A`: Planned/Actual treatment for period 01
- `TRT01PN` / `TRT01AN`: Numeric versions
- `TRTP` / `TRTA`: Used in BDS datasets (period-independent)

### Analysis variables (BDS)
- `AVAL`: Numeric analysis value
- `AVALC`: Character analysis value
- `BASE`: Baseline value
- `CHG`: Change from baseline
- `PCHG`: Percent change from baseline
- `ABLFL`: Baseline record flag
- `AVISIT` / `AVISITN`: Analysis visit (character/numeric)
- `PARAMCD` / `PARAM` / `PARAMN`: Parameter identification
- `ANL01FL`: Analysis record flag 01 (for primary analysis)
- `DTYPE`: Derivation type (LOCF, WOCF, AVERAGE, etc.)

---

## SDTM-to-ADaM Domain Mapping Quick Reference

| ADaM Dataset | Primary SDTM | Supporting SDTM | Notes |
|-------------|-------------|-----------------|-------|
| ADSL | DM | DS, EX, SV, SC, MH, QS, SUPPDM | Always created first |
| ADAE | AE | SUPPAE | Merge ADSL for trt dates |
| ADLB | LB | SUPPLB | Standardized results (STRESN) |
| ADVS | VS | — | Position-specific params |
| ADEX | EX | — | Derived exposure params |
| ADQS* | QS | — | May split by instrument |
| ADCM | CM | — | WHO Drug coding |
| ADMH | MH | — | Baseline medical history |
| ADTTE | ADSL, ADAE, DS | RS (oncology) | Parameter-specific sources |
| ADEG | EG | — | ECG parameters |
| ADRS | RS | TU | Oncology response (admiralonco) |
| ADTR | TR | TU | Oncology tumor results |
