# Issue Summary — CDISCPILOT01 ADaM Generation

Generated: 2026-03-06

## Package Installation

The following packages were installed during this run:
- admiralonco 1.4.0
- admiralpeds 0.3.0
- admiralneuro 0.2.1
- admiralmetabolic 0.3.0
- admiralvaccine 0.6.0
- admiralophtha 1.4.0
- xportr 0.5.0
- metacore 0.2.1
- metatools 0.2.0

Installed to: `/Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/dev_libraries`

## SDTM Data Issues

1. **Partial dates in CM domain**: Many CM records have partial dates (year-only or year-month). Date parsing handled by only converting complete dates (10+ character strings). Records with partial dates have NA analysis dates but are retained in ADCM.

2. **Screen failures in DM**: DM contains 306 subjects including 52 screen failures (ARM = "Screen Failure"). ADSL retains all 306 subjects; population flags correctly identify the 254 randomized subjects.

3. **Missing EX end dates**: Two subjects (01-705-1018 and one other) had missing EX end dates, resulting in TRTEDT = -Inf before correction. Handled by converting infinite values to NA.

## Derivation Assumptions

1. **Site pooling**: Sites with fewer than 3 subjects in total (not per arm) were pooled to site "900". The SAP specifies pooling per arm, but the simplified pooling approach was used. This should be reviewed by a biostatistician.

2. **ADAS-Cog visit mapping**: VISITNUM-to-Week mapping was hardcoded based on the CDISC Pilot visit schedule: VISITNUM 3=Week 0 (Baseline), 7=Week 8, 9=Week 16, 11=Week 24. This was derived from the TV (Trial Visits) domain.

3. **CIBIC+ visit mapping**: CIBIC+ is only assessed post-baseline (Weeks 8, 16, 24). There is no baseline CIBIC+ score by definition (it is itself a measure of change from baseline).

4. **NPI-X windowed mean**: The mean NPI-X total score (NPTOTMN parameter, DTYPE="AVERAGE") averages all available NPI-X total scores from Week 4 through Week 24 per subject, as specified in T-16.

5. **Dermatological events custom query (CQ01NAM)**: Events were classified as "DERMATOLOGICAL EVENTS" based on SOC containing "SKIN" or "DERMAT", or PT containing "RASH", "PRURITUS", "DERMATITIS", "ERYTHEMA", "URTICARIA", or "SKIN". This is a heuristic classification that should be verified against the study's adjudication committee or medical review.

6. **LOCF implementation**: LOCF was implemented by carrying forward the last observed value to all subsequent expected visits where data is missing. The LOCF records are flagged with DTYPE="LOCF".

## Unresolved Gaps

1. **T-22 (Clinically Significant Change)**: The threshold for "clinically significant change from previous visit" requires an additional derived variable (absolute change from previous > 50% of normal range width). All underlying data (CHG, A1LO, A1HI) is present in ADLB. This derivation can be added during TLG programming or via a follow-up ADaM update.

2. **SUPPLB not merged**: The SUPPLB dataset (64,403 records) was not merged into ADLB to keep processing efficient. If supplemental lab qualifiers are needed for specific analyses, this merge can be added.

3. **Dataset-JSON format**: Output was exported as standard JSON (via jsonlite) rather than CDISC Dataset-JSON format (via datasetjson package) due to API differences in the datasetjson package. The JSON files contain the same data as the CSV files in array-of-objects format.

## Recommendations

1. Review site pooling logic against SAP specifications
2. Verify dermatological event classification with medical review
3. Add clinically significant change threshold derivation to ADLB if needed for T-22
4. Consider merging SUPPLB if supplemental qualifiers are required
5. Run CDISC validation rules engine on generated ADaM datasets (future validation skill)
