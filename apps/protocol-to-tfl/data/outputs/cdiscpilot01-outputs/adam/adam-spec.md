# ADaM Dataset Specification — CDISCPILOT01

Study: Xanomeline (TTS) in Alzheimer's Disease
Generated: 2026-03-06

## Summary

| Dataset | Label | Structure | Records | Subjects | Source SDTM |
|---------|-------|-----------|---------|----------|-------------|
| ADSL | Subject-Level Analysis Dataset | One row per subject | 306 | 306 | DM, DS, EX, SV, SC, MH, QS, VS, SUPPDM |
| ADAE | Adverse Event Analysis Dataset | One row per AE per subject | 1,191 | 246 | AE, SUPPAE |
| ADLB | Laboratory Analysis Dataset | One row per subject per param per visit | 58,700 | 254 | LB |
| ADVS | Vital Signs Analysis Dataset | One row per subject per param per visit | 29,635 | 254 | VS |
| ADEX | Exposure Analysis Dataset | One row per subject per param | 758 | 254 | EX |
| ADQSADAS | ADAS-Cog(11) Questionnaire Dataset | One row per subject per visit | 354 | 254 | QS (ADAS) |
| ADQSCIBC | CIBIC+ Questionnaire Dataset | One row per subject per visit | 105 | 49 | QS (CIBIC+) |
| ADQSNPIX | NPI-X Questionnaire Dataset | One row per subject per param per visit | 1,546 | 254 | QS (NPI-X) |
| ADCM | Concomitant Medication Dataset | One row per medication per subject | 7,510 | 229 | CM |
| ADTTE | Time-to-Event Analysis Dataset | One row per subject per TTE param | 252 | 252 | ADSL, ADAE |

---

## ADSL — Subject-Level Analysis Dataset

- **Structure**: One record per subject
- **Source SDTM**: DM, DS, EX, SV, SC, MH, QS, VS, SUPPDM
- **Supports TLGs**: T-1, T-2, T-3, T-4

| Variable | Label | Type | Source/Derivation |
|----------|-------|------|-------------------|
| STUDYID | Study Identifier | Char | DM.STUDYID |
| USUBJID | Unique Subject Identifier | Char | DM.USUBJID |
| SUBJID | Subject Identifier | Char | DM.SUBJID |
| SITEID | Study Site Identifier | Char | DM.SITEID |
| SITEGR1 | Pooled Analysis Site Group 1 | Char | Pool sites with <3 subjects |
| AGE | Age | Num | DM.AGE |
| AGEGR1 | Pooled Age Group 1 | Char | <65, 65-80, >80 |
| SEX | Sex | Char | DM.SEX |
| RACE | Race | Char | DM.RACE |
| RACEN | Race (N) | Num | WHITE=1, BLACK=2, AIAN=6 |
| TRT01P | Planned Treatment for Period 01 | Char | DM.ARM |
| TRT01A | Actual Treatment for Period 01 | Char | DM.ACTARM |
| TRT01PN | Planned Treatment (N) | Num | Placebo=0, Low=1, High=2 |
| TRTSDT | Date of First Exposure | Date | Min of EX.EXSTDTC |
| TRTEDT | Date of Last Exposure | Date | Max of EX.EXENDTC |
| TRTDUR | Treatment Duration (days) | Num | TRTEDT - TRTSDT + 1 |
| EOSSTT | End of Study Status | Char | DS: COMPLETED/DISCONTINUED |
| DCSREAS | Reason for Discontinuation | Char | DS.DSDECOD |
| ITTFL | Intent-to-Treat Flag | Char | SUPPDM.ITT |
| SAFFL | Safety Population Flag | Char | SUPPDM.SAFETY |
| EFFFL | Efficacy Population Flag | Char | SUPPDM.EFFICACY |
| COMP24FL | Completers of Week 24 Flag | Char | SUPPDM.COMPLT24 |
| EDUCLVL | Years of Education | Num | SC.EDLEVEL |
| MMSETOT | MMSE Total at Baseline | Num | Sum of QS MMSE items at BL |
| DISONSDT | Date of Disease Onset | Date | MH earliest Alzheimer's |
| DURDIS | Duration of Disease (months) | Num | Visit1 - DISONSDT |
| WEIGHTBL | Baseline Weight (kg) | Num | VS weight at VSBLFL=Y |
| HEIGHTBL | Baseline Height (cm) | Num | VS height at VSBLFL=Y |
| BMIBL | Baseline BMI (kg/m2) | Num | WEIGHTBL / (HEIGHTBL/100)^2 |
| BMIBLGR1 | Baseline BMI Group | Char | <25, 25-<30, >=30 |

---

## ADAE — Adverse Event Analysis Dataset

- **Structure**: One record per AE per subject
- **Source SDTM**: AE, SUPPAE
- **Supports TLGs**: T-18, T-19, F-1

| Variable | Label | Type | Source/Derivation |
|----------|-------|------|-------------------|
| AETERM | Reported AE Term | Char | AE.AETERM |
| AEDECOD | Dictionary-Derived Term | Char | AE.AEDECOD (MedDRA PT) |
| AEBODSYS | Body System or Organ Class | Char | AE.AEBODSYS (MedDRA SOC) |
| AESEV / AESEVN | Severity | Char/Num | AE.AESEV; 1=MILD,2=MOD,3=SEV |
| AESER | Serious Event | Char | AE.AESER |
| ASTDT / AENDT | Analysis Start/End Date | Date | AE.AESTDTC / AEENDTC |
| TRTEMFL | Treatment Emergent Flag | Char | Y if ASTDT >= TRTSDT |
| CQ01NAM | Customized Query 01 | Char | "DERMATOLOGICAL EVENTS" by SOC/PT |
| AOCCFL | 1st Occurrence Any AE | Char | First TEAE per subject |
| AOCCSFL | 1st Occurrence SOC | Char | First TEAE per SOC per subject |
| AOCCPFL | 1st Occurrence PT | Char | First TEAE per SOC/PT per subject |

---

## ADLB — Laboratory Analysis Dataset

- **Structure**: One record per subject per parameter per visit
- **Source SDTM**: LB
- **Supports TLGs**: T-20, T-21, T-22, T-23, T-24, T-25
- **Special derivations**: Shift analysis (BNRIND to ANRIND), Hy's Law flag

| Variable | Label | Type | Source/Derivation |
|----------|-------|------|-------------------|
| PARAMCD / PARAM | Parameter Code / Label | Char | LB.LBTESTCD / LBTEST(UNIT) |
| PARCAT1 | Parameter Category | Char | LB.LBCAT (HEMATOLOGY/CHEMISTRY) |
| AVAL | Analysis Value | Num | LB.LBSTRESN |
| BASE | Baseline Value | Num | AVAL at ABLFL=Y |
| CHG / PCHG | Change / Percent Change | Num | AVAL-BASE / 100*CHG/BASE |
| A1LO / A1HI | Normal Range | Num | LB.LBSTNRLO / LBSTNRHI |
| ANRIND / BNRIND | Normal Range Indicator | Char | LOW/NORMAL/HIGH |
| SHIFT1 | Shift from Baseline | Char | "BNRIND to ANRIND" |
| ABLFL | Baseline Record Flag | Char | LB.LBBLFL |
| HYSLAWFL | Hy's Law Flag | Char | ALT/AST>3xULN AND BILI>2xULN |

---

## ADVS — Vital Signs Analysis Dataset

- **Structure**: One record per subject per parameter per visit
- **Source SDTM**: VS
- **Supports TLGs**: T-26, T-27, T-28
- **Parameters**: Position-specific (SYSBP_SUPINE, DIABP_STAND1, HR_STAND3, WEIGHT, HEIGHT, TEMP, etc.)

---

## ADEX — Exposure Analysis Dataset

- **Structure**: One record per subject per parameter
- **Source SDTM**: EX
- **Supports TLGs**: T-17
- **Parameters**: AVGDD (Average Daily Dose), CUMD (Cumulative Dose), TRTDUR (Treatment Duration)

---

## ADQSADAS — ADAS-Cog(11) Questionnaire Dataset

- **Structure**: One record per subject per visit
- **Source SDTM**: QS (QSTESTCD = ACTOT)
- **Supports TLGs**: T-5, T-7, T-9, T-11, T-12, T-13, T-14, T-15
- **Special derivations**: LOCF imputation for missing post-baseline visits
- **Analysis flags**: ANL01FL (LOCF primary), ANL02FL (Observed cases only)

---

## ADQSCIBC — CIBIC+ Questionnaire Dataset

- **Structure**: One record per subject per visit
- **Source SDTM**: QS (QSTESTCD = CIBIC)
- **Supports TLGs**: T-6, T-8, T-10
- **Note**: No baseline score (CIBIC+ is itself a change measure). LOCF applied.

---

## ADQSNPIX — NPI-X Questionnaire Dataset

- **Structure**: One record per subject per parameter per visit
- **Source SDTM**: QS (QSTESTCD = NPTOT)
- **Supports TLGs**: T-16
- **Parameters**: NPTOT (visit-level total), NPTOTMN (mean of Week 4-24 scores, DTYPE=AVERAGE)

---

## ADCM — Concomitant Medication Dataset

- **Structure**: One record per medication per subject
- **Source SDTM**: CM
- **Supports TLGs**: T-29
- **Flags**: CONCOMFL (overlaps treatment), PREFL (before treatment), ONTRTFL (on treatment)

---

## ADTTE — Time-to-Event Analysis Dataset

- **Structure**: One record per subject per TTE parameter
- **Source**: ADSL, ADAE
- **Supports TLGs**: F-1
- **Parameters**: TTDERM (Time to First Dermatological Event)
- **Event**: First TEAE with CQ01NAM = "DERMATOLOGICAL EVENTS"
- **Censoring**: Last treatment date for subjects without event (CNSR=1)
- **Origin**: TRTSDT (date of first dose)
