# TLG-to-ADaM Cross-Reference — CDISCPILOT01

Generated: 2026-03-06

## Cross-Reference Table

| TLG ID | Title | Required ADaM | Status | Key Variables | Notes |
|--------|-------|---------------|--------|---------------|-------|
| T-1 | Summary of Populations | ADSL | OK | ITTFL, SAFFL, EFFFL, COMP24FL | All flags present |
| T-2 | Summary of End of Study Data | ADSL | OK | EOSSTT, DCSREAS | Disposition derived from DS |
| T-3 | Summary of Demographics and Baseline | ADSL | OK | AGE, AGEGR1, SEX, RACE, MMSETOT, DURDIS, EDUCLVL, WEIGHTBL, HEIGHTBL, BMIBL, BMIBLGR1 | All variables present |
| T-4 | Summary of Subjects by Site | ADSL | OK | SITEID, SITEGR1 | Sites pooled per <3 rule |
| T-5 | ADAS Cog(11) CFB to Week 24 LOCF | ADQSADAS | OK | AVAL, BASE, CHG, SITEGR1, TRT01PN | LOCF via ANL01FL, dose-response coding via TRT01PN |
| T-6 | CIBIC+ at Week 24 LOCF | ADQSCIBC | OK | AVAL, AVALC, SITEGR1 | No baseline (CIBIC+ is change measure) |
| T-7 | ADAS Cog(11) CFB to Week 8 LOCF | ADQSADAS | OK | Same as T-5 at AVISITN=8 | |
| T-8 | CIBIC+ at Week 8 LOCF | ADQSCIBC | OK | Same as T-6 at AVISITN=8 | |
| T-9 | ADAS Cog(11) CFB to Week 16 LOCF | ADQSADAS | OK | Same as T-5 at AVISITN=16 | |
| T-10 | CIBIC+ at Week 16 LOCF | ADQSCIBC | OK | Same as T-6 at AVISITN=16 | |
| T-11 | ADAS Cog(11) Completers Week 24 OC | ADQSADAS | OK | ANL02FL for observed cases, COMP24FL from ADSL | Windowed to AVISITN=24 |
| T-12 | ADAS Cog(11) Males LOCF | ADQSADAS | OK | SEX (from ADSL merge) | Filter SEX="M" |
| T-13 | ADAS Cog(11) Females LOCF | ADQSADAS | OK | SEX (from ADSL merge) | Filter SEX="F" |
| T-14 | ADAS Cog(11) Mean over Time | ADQSADAS | OK | AVAL, CHG by AVISIT | All visits: BL, Wk8, 16, 24 |
| T-15 | ADAS Cog(11) MMRM | ADQSADAS | OK | AVAL, BASE, CHG, SITEGR1, AVISIT | Repeated measures analysis |
| T-16 | NPI-X Total Mean Wk4-24 | ADQSNPIX | OK | NPTOTMN param (DTYPE=AVERAGE), BASE | Windowed mean endpoint |
| T-17 | Exposure Summary | ADEX | OK | AVGDD, CUMD, TRTDUR params | 3 parameters per subject |
| T-18 | TEAE by SOC/PT | ADAE | OK | TRTEMFL, AEBODSYS, AEDECOD, AOCCSFL, AOCCPFL | Fisher's test on occurrence flags |
| T-19 | Serious TEAEs | ADAE | OK | TRTEMFL, AESER="Y" | Subset of ADAE |
| T-20 | Lab Summary Statistics | ADLB | OK | AVAL, PARAMCD, PARCAT1, AVISIT | By visit, by category |
| T-21 | Lab Abnormal (Beyond Normal Range) | ADLB | OK | ANRIND, ANL01FL | Count LOW/HIGH during treatment |
| T-22 | Lab Abnormal (Clinically Sig Change) | ADLB | PARTIAL | CHG, A1LO, A1HI | May need derived threshold variable |
| T-23 | Lab Shift by Visit | ADLB | OK | SHIFT1, BNRIND, ANRIND, AVISIT | Shift at each visit |
| T-24 | Lab Shift Overall | ADLB | OK | BNRIND, ANRIND | Baseline vs most extreme on-treatment |
| T-25 | Hy's Law Shift | ADLB | OK | HYSLAWFL, BNRIND, ANRIND | ALT/AST & BILI combination |
| T-26 | Vital Signs BL and EOT | ADVS | OK | AVAL, ABLFL, EOTFL, PARAMCD | Position-specific params |
| T-27 | Vital Signs CFB at EOT | ADVS | OK | CHG, EOTFL | Change from baseline at last on-treatment |
| T-28 | Weight CFB at EOT | ADVS | OK | PARAMCD="WEIGHT", CHG, COMP24FL | Split completers/all |
| T-29 | Concomitant Medications | ADCM | OK | CMDECOD, CMCLAS, CONCOMFL | By body system/ingredient |
| F-1 | KM: Time to First Derm Event | ADTTE | OK | AVAL, CNSR, TRT01P | PARAMCD="TTDERM" |

## Summary

- **Total TLGs**: 30 (29 tables + 1 figure)
- **Fully supported**: 29 (97%)
- **Partially supported**: 1 (T-22: may need additional derived threshold for clinically significant change)
- **Not supported**: 0

## Notes

1. **T-22 (Clinically Significant Change)**: The ADLB dataset contains CHG and normal range limits (A1LO, A1HI), but the specific threshold for "clinically significant change from previous visit" (absolute change > 50% of normal range) would need an additional derived variable. The data needed is present, but the specific derivation may need to be added during TLG programming.

2. **ADQSCIBC low subject count**: Only 49 subjects had observed CIBIC+ data (not assessed at all visits for all subjects). LOCF brings the Week 24 analysis set to approximately 49 subjects, which matches the study design (CIBIC+ assessed at Weeks 8, 16, 24 only, many dropouts before Week 8).

3. **ADQSADAS visit mapping**: The ADAS-Cog was assessed at visits corresponding to Weeks 0, 8, 16, 24 in the SDTM. Visit windowing was applied via VISITNUM mapping.
