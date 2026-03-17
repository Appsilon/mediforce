# Mock TLG Shells — CDISCPILOT01: Xanomeline TTS in Mild-to-Moderate AD

## Generation Metadata

- Source: CDISCPILOT01 trial metadata (extract-metadata step output)
- Generated: 2026-03-11
- Phase: Phase II
- Design: Randomized, double-blind, placebo-controlled, parallel-group, multi-center (17 sites)
- Arms: 3 (Placebo TTS, Xanomeline Low Dose TTS 54mg, Xanomeline High Dose TTS 81mg)
- Actual Randomized N: 295 (PBO=100, XAN_LOW=98, XAN_HIGH=97)
- Total TLGs: 31 (Tables: 30, Listings: 0, Figures: 1)
- Note: Listings not included per SAP pilot scope. Reference SAP Section 13.1.

---

## TLG Index

| TLG ID | Title | Population | Section |
|--------|-------|------------|---------|
| T-01 | Summary of Populations | All Subjects | 14.1 |
| T-02 | Summary of End of Study Data | Intent-to-Treat | 14.1 |
| T-03 | Summary of Demographic and Baseline Characteristics | Intent-to-Treat | 14.1 |
| T-04 | Summary of Number of Subjects by Site | Intent-to-Treat | 14.1 |
| T-05 | Primary Endpoint: ADAS-Cog (11) – Change from Baseline to Week 24 – LOCF | Efficacy | 14.2 |
| T-06 | Primary Endpoint: CIBIC+ – Summary at Week 24 – LOCF | Efficacy | 14.2 |
| T-07 | ADAS-Cog (11) – Change from Baseline to Week 8 – LOCF | Efficacy | 14.2 |
| T-08 | CIBIC+ – Summary at Week 8 – LOCF | Efficacy | 14.2 |
| T-09 | ADAS-Cog (11) – Change from Baseline to Week 16 – LOCF | Efficacy | 14.2 |
| T-10 | CIBIC+ – Summary at Week 16 – LOCF | Efficacy | 14.2 |
| T-11 | ADAS-Cog (11) – Change from Baseline to Week 24 – Completers – Observed Cases-Windowed | Efficacy (Completers) | 14.2 |
| T-12 | ADAS-Cog (11) – Change from Baseline to Week 24 in Male Subjects – LOCF | Efficacy (Males) | 14.2 |
| T-13 | ADAS-Cog (11) – Change from Baseline to Week 24 in Female Subjects – LOCF | Efficacy (Females) | 14.2 |
| T-14 | ADAS-Cog (11) – Mean and Mean Change from Baseline over Time | Efficacy | 14.2 |
| T-15 | ADAS-Cog (11) – Repeated Measures Analysis of Change from Baseline to Week 24 | Efficacy | 14.2 |
| T-16 | Mean NPI-X Total Score from Week 4 through Week 24 – Windowed | Efficacy | 14.2 |
| T-17 | Summary of Planned Exposure to Study Drug, as of End of Study | Safety | 14.3 |
| T-18 | Incidence of Treatment Emergent Adverse Events by Treatment Group | Safety | 14.3.1 |
| T-19 | Incidence of Treatment Emergent Serious Adverse Events by Treatment Group | Safety | 14.3.1 |
| T-20 | Summary Statistics for Continuous Laboratory Values | Safety | 14.3.2 |
| T-21 | Frequency of Normal and Abnormal (Beyond Normal Range) Laboratory Values During Treatment | Safety | 14.3.2 |
| T-22 | Frequency of Normal and Abnormal (Clinically Significant Change from Previous Visit) Laboratory Values During Treatment | Safety | 14.3.2 |
| T-23 | Shifts of Laboratory Values During Treatment, by Visit | Safety | 14.3.2 |
| T-24 | Shifts of Laboratory Values During Treatment (Overall) | Safety | 14.3.2 |
| T-25 | Shifts of Hy's Law Values During Treatment | Safety | 14.3.2 |
| T-26 | Summary of Vital Signs at Baseline and End of Treatment | Safety | 14.3.3 |
| T-27 | Summary of Vital Signs Change From Baseline at End of Treatment | Safety | 14.3.3 |
| T-28 | Summary of Weight Change From Baseline at End of Treatment | Safety | 14.3.3 |
| T-29 | Summary of Concomitant Medications (Number of Subjects) | All Subjects | 14.5 |
| T-AH01 | CIBIC+ – Categorical Analysis – LOCF (Ad hoc) | Efficacy | 14.2 |
| F-01 | Time to First Dermatological Event by Treatment Group | Safety | 15.2 |

---

## Table Shells

---

### T-01: Summary of Populations

**Title:** Summary of Populations
**Population:** All Subjects
**Layout:** Portrait
**ADaM Dataset(s):** ADSL
**Page:** 14.1

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-01. Summary of Populations

                                   Placebo TTS      Xanomeline       Xanomeline       Total
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)    (N=xxx)

Screened                           xxx              xxx              xxx              xxx
Randomized (ITT)                   xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)
Safety Population (SAF)            xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)
Efficacy Population                xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)
  (Modified ITT)
Completers (Week 24)               xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)
Completed Study (Week 26)          xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)     xxx (xxx.x%)
```

**Footnotes:**
1. Randomized = all patients assigned to a treatment group at Visit 3 (Week 0). Equivalent to the Intent-to-Treat (ITT) population.
2. Safety population (SAF): all randomized patients known to have taken at least one dose of randomized study drug.
3. Efficacy population: all patients in the safety population who have at least one post-baseline assessment for both ADAS-Cog (11) and CIBIC+. This population serves as the primary efficacy analysis population (modified ITT).
4. Completers (Week 24): all patients in the efficacy population who completed their Week 24 visit (Visit 12).
5. Percentages are calculated with the number of screened patients as denominator for "Randomized" row; for all other rows, the denominator is the randomized (ITT) population.
6. Source: ADSL (RANDFL, SAFFL, EFFFL, COMP24FL, COMPLFL flags).

**Programming Notes:**
- Key ADSL variables: RANDFL, SAFFL, EFFFL, COMP24FL, COMPLFL, TRT01A.
- Screened N from disposition records (ADSL where SCRFL='Y' or all records).

---

### T-02: Summary of End of Study Data

**Title:** Summary of End of Study Data
**Population:** Intent-to-Treat (ITT)
**Layout:** Portrait
**ADaM Dataset(s):** ADSL
**Page:** 14.1

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-02. Summary of End of Study Data
Intent-to-Treat Population

                                   Placebo TTS      Xanomeline       Xanomeline       Total
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)    (N=xxx)

Completed Study                    xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
Discontinued                       xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)

  Reason for Discontinuation:
    Adverse Event                  xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
    Death                          xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
    Lack of Efficacy               xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
    Lost to Follow-up              xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
    Patient/Guardian Decision      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
    Protocol Violation             xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)
    Other                          xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)

  p-value vs. Placebo (Fisher's):
    Low Dose vs. Placebo                            x.xxxx
    High Dose vs. Placebo                                            x.xxxx
```

**Footnotes:**
1. ITT population: all randomized patients (N=295 total; Placebo=100, Low Dose=98, High Dose=97).
2. Percentages based on ITT population N per treatment group.
3. P-values from Fisher's exact test comparing each active treatment group to placebo for overall discontinuation rate.
4. Source: ADSL (DCSREAS, EOSReason variables).

**Programming Notes:**
- Key ADSL variables: EOSSTT, DCSREAS, TRT01A.
- Discontinuation reasons should be mutually exclusive; "Completed" and each reason are exhaustive.

---

### T-03: Summary of Demographic and Baseline Characteristics

**Title:** Summary of Demographic and Baseline Characteristics
**Population:** Intent-to-Treat (ITT)
**Layout:** Portrait (may span multiple pages)
**ADaM Dataset(s):** ADSL, ADEFF (for MMSE baseline)
**Page:** 14.1

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-03. Summary of Demographic and Baseline Characteristics
Intent-to-Treat Population

                                   Placebo TTS      Xanomeline       Xanomeline       Total
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)    (N=xxx)

AGE (years)
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median                           xx.x             xx.x             xx.x             xx.x
  Min, Max                         xx, xx           xx, xx           xx, xx           xx, xx

Age Category, n (%)
  < 65 years                       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  65 to 80 years                   xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  > 80 years                       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

SEX, n (%)
  Male                             xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Female                           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

RACE, n (%)
  White                            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Black or African American        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Asian                            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Other                            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

MMSE SCORE at Screening (Visit 1)
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median                           xx.x             xx.x             xx.x             xx.x
  Min, Max                         xx, xx           xx, xx           xx, xx           xx, xx

DURATION OF DISEASE (years)
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median                           xx.x             xx.x             xx.x             xx.x
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

YEARS OF EDUCATION
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median                           xx.x             xx.x             xx.x             xx.x
  Min, Max                         xx, xx           xx, xx           xx, xx           xx, xx

WEIGHT at Baseline (kg)
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median                           xx.x             xx.x             xx.x             xx.x
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

HEIGHT at Screening (cm)
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xxx.x (xx.xx)    xxx.x (xx.xx)    xxx.x (xx.xx)    xxx.x (xx.xx)
  Median                           xxx.x            xxx.x            xxx.x            xxx.x
  Min, Max                         xxx.x, xxx.x     xxx.x, xxx.x     xxx.x, xxx.x     xxx.x, xxx.x

BMI at Baseline (kg/m²)
  N                                xxx              xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median                           xx.x             xx.x             xx.x             xx.x
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

BMI Category, n (%)
  < 18.5 (Underweight)             xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  18.5 to < 25 (Normal)            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  25 to < 30 (Overweight)          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  >= 30 (Obese)                    xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
```

**Footnotes:**
1. ITT population: all randomized patients (N=295; Placebo=100, Low Dose=98, High Dose=97).
2. MMSE score used as inclusion criterion (10–23); assessed at Visit 1 (Screening/Week -2).
3. BMI calculated as weight (kg) / height (m)². Weight from Visit 3 (Baseline); height from Visit 1 (Screening).
4. Duration of disease defined as time from AD diagnosis to randomization date.
5. Source: ADSL (AGE, SEX, RACE, BMIBL, WEIGHTBL, HEIGHTBL, EDUCLVL, DURDIS), ADEFF or ADQS for MMSE baseline.

**Programming Notes:**
- MMSE baseline: use Visit 1 (AVISIT='SCREENING') from ADQS or BDS dataset for MMSE parameter.
- Weight baseline = Visit 3 (ADSL.WEIGHTBL); height baseline = Visit 1 (ADSL.HEIGHTBL).
- BMI = ADSL.BMIBL.

---

### T-04: Summary of Number of Subjects by Site

**Title:** Summary of Number of Subjects by Site
**Population:** Intent-to-Treat (ITT)
**Layout:** Portrait
**ADaM Dataset(s):** ADSL
**Page:** 14.1

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-04. Summary of Number of Subjects by Site
Intent-to-Treat Population

                                   Placebo TTS      Xanomeline       Xanomeline       Total
  Site                                            Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)    (N=xxx)

Site 001                           xx               xx               xx               xx
Site 002                           xx               xx               xx               xx
Site 003                           xx               xx               xx               xx
Site 004                           xx               xx               xx               xx
Site 005                           xx               xx               xx               xx
Site 006                           xx               xx               xx               xx
Site 007                           xx               xx               xx               xx
Site 008                           xx               xx               xx               xx
Site 009                           xx               xx               xx               xx
Site 010                           xx               xx               xx               xx
Site 011                           xx               xx               xx               xx
Site 012                           xx               xx               xx               xx
Site 013                           xx               xx               xx               xx
Site 014                           xx               xx               xx               xx
Site 015                           xx               xx               xx               xx
Site 016                           xx               xx               xx               xx
Site 017                           xx               xx               xx               xx
  [Pooled Sites]a                  xx               xx               xx               xx

Total                              xxx              xxx              xxx              xxx
```

**Footnotes:**
1. ITT population: all randomized patients.
2. a Sites enrolling fewer than 3 patients in any treatment group are pooled for analysis purposes per SAP Section 11.1.
3. Source: ADSL (SITEID, TRT01A).

**Programming Notes:**
- Key ADSL variables: SITEID (or INVID), TRT01A, RANDFL='Y'.
- Pooling rule: sites with <3 subjects in any treatment group are pooled into a single "Pooled" row.

---

### T-05: Primary Endpoint Analysis — ADAS-Cog (11) Change from Baseline to Week 24 – LOCF

**Title:** Primary Endpoint Analysis: ADAS-Cog (11) – Change from Baseline to Week 24 – LOCF
**Population:** Efficacy (Modified ITT)
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-05. Primary Endpoint Analysis: ADAS-Cog (11) – Change from Baseline to Week 24 – LOCF
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

ADAS-Cog (11) at Baseline
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

ADAS-Cog (11) at Week 24 (LOCF)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

Change from Baseline at Week 24 (LOCF)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

ANCOVA Results (Primary Analysis)a
  LS Mean                          xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI for LS Mean               (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

Test for Linear Dose Response
  p-valueb                         x.xxxx

Pairwise Comparisons (Conditional on Dose Response Test)c
  Low Dose vs. Placebo
    Difference in LS Means                          xx.xx
    95% CI                                          (xx.xx, xx.xx)
    p-value                                         x.xxxx
  High Dose vs. Placebo
    Difference in LS Means                                           xx.xx
    95% CI                                                           (xx.xx, xx.xx)
    p-value                                                          x.xxxx
  High Dose vs. Low Dose
    Difference in LS Means                                           xx.xx
    95% CI                                                           (xx.xx, xx.xx)
    p-value                                                          x.xxxx
```

**Footnotes:**
1. Efficacy population: all patients in the safety population with at least one post-baseline assessment for both ADAS-Cog (11) and CIBIC+.
2. ADAS-Cog (11): 11-item cognitive subscale (items 1–2, 4–8, 11–14 of the 14-item instrument); total score range 0–70; higher score = greater impairment; negative change = improvement.
3. Missing Week 24 values imputed using Last Observation Carried Forward (LOCF) based on targeted (windowed) assessments at Weeks 8, 16, and 24.
4. a ANCOVA model: Change from baseline = Site + Treatment (continuous, dose response) + Baseline ADAS-Cog (11). Site × Treatment interaction tested at alpha=0.10; if not significant, dropped from model. Sites with fewer than 3 patients per treatment group pooled. Treatment coded as continuous dose: Placebo=0, Low Dose=54, High Dose=81 (mg).
5. b P-value for the test of linear dose response (H0: coefficient for treatment = 0), two-sided, nominal alpha=0.05.
6. c Pairwise comparisons reported only if the overall dose-response test is statistically significant (p<0.05). LS Mean differences computed from LSMEANS statement in GLM procedure.
7. Source dataset: ADEFF. Key variables: AVAL (ADAS-Cog 11 score), CHG (change from baseline), AVISITN=24, DTYPE='LOCF', PARAMCD='ADASCOG11', EFFFL='Y'.

**Programming Notes:**
- Dataset: ADEFF, PARAMCD='ADASCOG11', AVISITN=2400 (or Week 24 visit number), DTYPE='LOCF', EFFFL='Y'.
- Baseline: ABLFL='Y'.
- ANCOVA via SAS PROC GLM with LSMEANS / PDIFF.
- If Shapiro-Wilk test on residuals shows non-normality, also run analysis on ranks (PROC RANK + PROC GLM).

---

### T-06: Primary Endpoint Analysis — CIBIC+ Summary at Week 24 – LOCF

**Title:** Primary Endpoint Analysis: CIBIC+ – Summary at Week 24 – LOCF
**Population:** Efficacy (Modified ITT)
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-06. Primary Endpoint Analysis: CIBIC+ – Summary at Week 24 – LOCF
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

CIBIC+ at Week 24 (LOCF): Distribution, n (%)
  1 – Marked Improvement           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  2 – Moderate Improvement         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  3 – Minimal Improvement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  4 – No Change                    xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  5 – Minimal Worsening            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  6 – Moderate Worsening           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  7 – Marked Worsening             xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Missing                          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

CIBIC+ at Week 24 (LOCF): Descriptive Statistics
  N                                xxx              xxx              xxx
  Mean (SD)                        x.xx (x.xxx)     x.xx (x.xxx)     x.xx (x.xxx)
  Median                           x.x              x.x              x.x
  Min, Max                         x, x             x, x             x, x

ANOVA Results (Primary Analysis)a
  LS Mean                          x.xx             x.xx             x.xx
  SE                               x.xxx            x.xxx            x.xxx
  95% CI for LS Mean               (x.xx, x.xx)     (x.xx, x.xx)     (x.xx, x.xx)

Test for Linear Dose Response
  p-valueb                         x.xxxx

Pairwise Comparisons (Conditional on Dose Response Test)c
  Low Dose vs. Placebo
    Difference in LS Means                          x.xx
    95% CI                                          (x.xx, x.xx)
    p-value                                         x.xxxx
  High Dose vs. Placebo
    Difference in LS Means                                           x.xx
    95% CI                                                           (x.xx, x.xx)
    p-value                                                          x.xxxx
  High Dose vs. Low Dose
    Difference in LS Means                                           x.xx
    95% CI                                                           (x.xx, x.xx)
    p-value                                                          x.xxxx
```

**Footnotes:**
1. Efficacy population: all patients in the safety population with at least one post-baseline ADAS-Cog (11) and CIBIC+ assessment.
2. CIBIC+: 7-point global impression scale (1=Marked improvement, 4=No change, 7=Marked worsening). Reflects change from baseline; no numeric baseline value exists.
3. Missing Week 24 values imputed using LOCF based on windowed assessments at Weeks 8, 16, and 24.
4. a ANOVA model: CIBIC+ score = Site + Treatment (continuous). No baseline covariate (CIBIC+ inherently measures change from baseline). Site × Treatment interaction tested at alpha=0.10; pooling as per T-05 footnote.
5. b Two-sided p-value for linear dose-response test, nominal alpha=0.05.
6. c Pairwise comparisons reported conditionally on significant dose-response test. See T-05 footnote c.
7. Source: ADEFF. PARAMCD='CIBICPLS', AVISITN=24, DTYPE='LOCF', EFFFL='Y'.

**Programming Notes:**
- Dataset: ADEFF, PARAMCD='CIBICPLS', AVISITN=2400, DTYPE='LOCF', EFFFL='Y'.
- ANOVA via PROC GLM (no baseline covariate).

---

### T-07: ADAS-Cog (11) – Change from Baseline to Week 8 – LOCF

**Title:** ADAS-Cog (11) – Change from Baseline to Week 8 – LOCF
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-07. ADAS-Cog (11) – Change from Baseline to Week 8 – LOCF
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

ADAS-Cog (11) at Baseline
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

Change from Baseline at Week 8 (LOCF)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

ANCOVA Resultsa
  LS Mean                          xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI for LS Mean               (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

Test for Linear Dose Response
  p-value                          x.xxxx

Pairwise Comparisons (Conditional)
  Low Dose vs. Placebo: Diff (95% CI), p-value    xx.xx (xx.xx, xx.xx)   x.xxxx
  High Dose vs. Placebo: Diff (95% CI), p-value                          xx.xx (xx.xx, xx.xx)   x.xxxx
  High Dose vs. Low Dose: Diff (95% CI), p-value                         xx.xx (xx.xx, xx.xx)   x.xxxx
```

**Footnotes:**
1. Same ANCOVA model as T-05 applied at Week 8. Assessment window: Day 2–84 (target Day 56, Visit 8).
2. LOCF at Week 8: last available targeted assessment on or before Week 8 window carried forward.
3. Nominal p-values; no multiplicity adjustment. Source: ADEFF, AVISITN=800, DTYPE='LOCF'.

---

### T-08: CIBIC+ – Summary at Week 8 – LOCF

**Title:** CIBIC+ – Summary at Week 8 – LOCF
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-08. CIBIC+ – Summary at Week 8 – LOCF
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

CIBIC+ at Week 8 (LOCF): Distribution, n (%)
  1 – Marked Improvement           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  2 – Moderate Improvement         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  3 – Minimal Improvement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  4 – No Change                    xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  5 – Minimal Worsening            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  6 – Moderate Worsening           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  7 – Marked Worsening             xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

CIBIC+ at Week 8 (LOCF): Descriptive Statistics
  N                                xxx              xxx              xxx
  Mean (SD)                        x.xx (x.xxx)     x.xx (x.xxx)     x.xx (x.xxx)
  Median                           x.x              x.x              x.x

ANOVA Results
  LS Mean                          x.xx             x.xx             x.xx
  95% CI                           (x.xx, x.xx)     (x.xx, x.xx)     (x.xx, x.xx)

Test for Linear Dose Response
  p-value                          x.xxxx

Pairwise Comparisons (Conditional)
  Low Dose vs. Placebo: Diff, 95% CI, p            x.xx  (x.xx, x.xx)  x.xxxx
  High Dose vs. Placebo: Diff, 95% CI, p                               x.xx  (x.xx, x.xx)  x.xxxx
```

**Footnotes:**
1. Same ANOVA model as T-06 applied at Week 8. Assessment window: Day 2–84 (target Day 56).
2. Source: ADEFF, PARAMCD='CIBICPLS', AVISITN=800, DTYPE='LOCF'.

---

### T-09: ADAS-Cog (11) – Change from Baseline to Week 16 – LOCF

**Title:** ADAS-Cog (11) – Change from Baseline to Week 16 – LOCF
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

*[Shell structure identical to T-07; substitute Week 16 values and AVISITN=1600, window Day 85–140.]*

```
ANCOVA model, LOCF at Week 16. Assessment window: Day 85–140 (target Day 112, Visit 10).
Row stubs, column structure, and footnote pattern identical to T-07.
Source: ADEFF, PARAMCD='ADASCOG11', AVISITN=1600, DTYPE='LOCF'.
```

---

### T-10: CIBIC+ – Summary at Week 16 – LOCF

**Title:** CIBIC+ – Summary at Week 16 – LOCF
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

*[Shell structure identical to T-08; substitute Week 16 values and AVISITN=1600, window Day 85–140.]*

```
ANOVA model, LOCF at Week 16. Assessment window: Day 85–140 (target Day 112, Visit 10).
Row stubs, column structure, and footnote pattern identical to T-08.
Source: ADEFF, PARAMCD='CIBICPLS', AVISITN=1600, DTYPE='LOCF'.
```

---

### T-11: ADAS-Cog (11) – Change from Baseline to Week 24 – Completers – Observed Cases-Windowed

**Title:** ADAS-Cog (11) – Change from Baseline to Week 24 – Completers at Week 24 – Observed Cases-Windowed
**Population:** Efficacy (Completers at Week 24)
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-11. ADAS-Cog (11) – Change from Baseline to Week 24 – Completers at Week 24 – Observed Cases
Efficacy Population (Completers Subset)

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)a       54 mg (N=xxx)a   81 mg (N=xxx)a

ADAS-Cog (11) at Baseline
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

Change from Baseline at Week 24 (Observed)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

ANCOVA Resultsb
  LS Mean                          xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI for LS Mean               (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

Test for Linear Dose Response
  p-value                          x.xxxx

Pairwise Comparisons (Conditional)
  Low Dose vs. Placebo: Diff (95% CI), p           xx.xx (xx.xx, xx.xx)  x.xxxx
  High Dose vs. Placebo: Diff (95% CI), p                                xx.xx (xx.xx, xx.xx)  x.xxxx
  High Dose vs. Low Dose: Diff (95% CI), p                               xx.xx (xx.xx, xx.xx)  x.xxxx
```

**Footnotes:**
1. a N values reflect completers subset: patients in the efficacy population who completed Week 24 visit (Visit 12, COMP24FL='Y').
2. b Same ANCOVA model as T-05 applied to completers subset with observed (non-imputed) windowed Week 24 data. DTYPE=''. Assessment window: Day >140.
3. This is a sensitivity analysis for the primary endpoint. No LOCF imputation applied.
4. Source: ADEFF, PARAMCD='ADASCOG11', AVISITN=2400, DTYPE='' (observed), COMP24FL='Y'.

---

### T-12: ADAS-Cog (11) – Change from Baseline to Week 24 in Male Subjects – LOCF

**Title:** ADAS-Cog (11) – Change from Baseline to Week 24 in Male Subjects – LOCF
**Population:** Efficacy (Males)
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-12. ADAS-Cog (11) – Change from Baseline to Week 24 in Male Subjects – LOCF
Efficacy Population (Male Subjects)

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)a       54 mg (N=xxx)a   81 mg (N=xxx)a

ADAS-Cog (11) at Baseline
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

Change from Baseline at Week 24 (LOCF)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

ANCOVA Results
  LS Mean                          xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI                           (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

Test for Linear Dose Response
  p-value                          x.xxxx

Pairwise Comparisons (Conditional)
  Low Dose vs. Placebo             xx.xx (xx.xx, xx.xx)   x.xxxx
  High Dose vs. Placebo                                   xx.xx (xx.xx, xx.xx)   x.xxxx
```

**Footnotes:**
1. a N values reflect male subjects only (SEX='M') within the efficacy population.
2. Same ANCOVA model as T-05 applied to male subgroup. Results are exploratory; no multiplicity adjustment.
3. This analysis performed conditional on adequate sample size per SAP Section 7.2.
4. Source: ADEFF, PARAMCD='ADASCOG11', AVISITN=2400, DTYPE='LOCF', SEX='M', EFFFL='Y'.

---

### T-13: ADAS-Cog (11) – Change from Baseline to Week 24 in Female Subjects – LOCF

**Title:** ADAS-Cog (11) – Change from Baseline to Week 24 in Female Subjects – LOCF
**Population:** Efficacy (Females)
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

*[Structure identical to T-12; replace SEX='M' with SEX='F'.]*

---

### T-14: ADAS-Cog (11) – Mean and Mean Change from Baseline over Time

**Title:** ADAS-Cog (11) – Mean and Mean Change from Baseline over Time
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-14. ADAS-Cog (11) – Mean and Mean Change from Baseline over Time
Efficacy Population (LOCF)

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

Baseline (Visit 3)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median (Min, Max)                xx.xx (x.x, xx.x) xx.xx (x.x, xx.x) xx.xx (x.x, xx.x)

Week 8 (Visit 8, LOCF)
  N                                xxx              xxx              xxx
  Mean Absolute Score (SD)         xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Mean Change from Baseline (SD)   xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

Week 16 (Visit 10, LOCF)
  N                                xxx              xxx              xxx
  Mean Absolute Score (SD)         xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Mean Change from Baseline (SD)   xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)

Week 24 (Visit 12, LOCF) [Primary Endpoint]
  N                                xxx              xxx              xxx
  Mean Absolute Score (SD)         xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Mean Change from Baseline (SD)   xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median Change (Min, Max)         xx.xx (xx.x, xx.x) xx.xx (xx.x, xx.x) xx.xx (xx.x, xx.x)
```

**Footnotes:**
1. ADAS-Cog (11): 11-item subscale, range 0–70; higher score = greater impairment; negative change = improvement.
2. LOCF imputation applied at each timepoint using targeted windowed assessments.
3. Baseline = Visit 3 (Day 1). Assessment windows: Week 8 = Day 2–84; Week 16 = Day 85–140; Week 24 = Day >140.
4. N values may differ across timepoints due to differential drop-out before LOCF anchoring.
5. Source: ADEFF, PARAMCD='ADASCOG11', DTYPE='LOCF', EFFFL='Y'. AVISITN: 800, 1600, 2400.

---

### T-15: ADAS-Cog (11) – Repeated Measures Analysis of Change from Baseline to Week 24

**Title:** ADAS-Cog (11) – Repeated Measures Analysis of Change from Baseline to Week 24
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-15. ADAS-Cog (11) – Repeated Measures Analysis of Change from Baseline to Week 24 (MMRM)
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

MMRM Estimates at Week 24a
  N (observed)                     xxx              xxx              xxx
  LS Mean Change from Baseline     xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI                           (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

MMRM Estimates at Week 16
  LS Mean Change from Baseline     xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI                           (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

MMRM Estimates at Week 8
  LS Mean Change from Baseline     xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI                           (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

Pairwise Comparisons at Week 24 (from MMRM)b
  Low Dose vs. Placebo
    Difference in LS Means                          xx.xx
    95% CI                                          (xx.xx, xx.xx)
    p-value                                         x.xxxx
  High Dose vs. Placebo
    Difference in LS Means                                           xx.xx
    95% CI                                                           (xx.xx, xx.xx)
    p-value                                                          x.xxxx
  High Dose vs. Low Dose
    Difference in LS Means                                           xx.xx
    95% CI                                                           (xx.xx, xx.xx)
    p-value                                                          x.xxxx

Covariance Structure:               Unstructured (or Toeplitz if singularity)c
-2 Log Likelihood:                  xxxx.x
AIC:                                xxxx.x
```

**Footnotes:**
1. a MMRM (Mixed-Effects Model for Repeated Measures): fixed categorical effects of treatment group, site, visit (week), treatment × visit interaction; continuous covariates of baseline ADAS-Cog (11) and baseline × visit interaction. Observed data only; no imputation. Assumes Missing At Random (MAR).
2. b P-values for pairwise comparisons from MMRM model at Week 24. Nominal alpha=0.05; no multiplicity adjustment. This is a supportive/sensitivity analysis; primary analysis results are in T-05.
3. c Unstructured covariance matrix; if computational singularity encountered, Toeplitz structure used.
4. Analysis performed in SAS PROC MIXED with REPEATED statement. LSMEANS / PDIFF at AVISITN=2400.
5. Source: ADEFF, PARAMCD='ADASCOG11', DTYPE='' (observed only), EFFFL='Y'. Visits: AVISITN=800, 1600, 2400.

---

### T-16: Mean NPI-X Total Score from Week 4 through Week 24 – Windowed

**Title:** Mean NPI-X Total Score from Week 4 through Week 24 – Windowed
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-16. Mean NPI-X Total Score from Week 4 through Week 24 – Windowed
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

NPI-X Total Score at Baseline (Visit 3)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median (Min, Max)                xx.x (x, xxx)    xx.x (x, xxx)    xx.x (x, xxx)

Mean NPI-X Total Score (Wks 4–24)a
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         x.x, xx.x        x.x, xx.x        x.x, xx.x

ANCOVA Resultsb
  LS Mean                          xx.xx            xx.xx            xx.xx
  SE                               xx.xxx           xx.xxx           xx.xxx
  95% CI for LS Mean               (xx.xx, xx.xx)   (xx.xx, xx.xx)   (xx.xx, xx.xx)

Test for Linear Dose Response
  p-value                          x.xxxx

Pairwise Comparisons (Conditional)
  Low Dose vs. Placebo: Diff (95% CI), p           xx.xx (xx.xx, xx.xx)  x.xxxx
  High Dose vs. Placebo: Diff (95% CI), p                                xx.xx (xx.xx, xx.xx)  x.xxxx
  High Dose vs. Low Dose: Diff (95% CI), p                               xx.xx (xx.xx, xx.xx)  x.xxxx
```

**Footnotes:**
1. a Mean NPI-X total score computed as the mean of all available windowed NPI-X (9-domain) total scores from Week 4 through Week 24, inclusive (Visits 5, 7, 8, 8.1, 9, 9.1, 10, 10.1, 11, 11.1, 12). Week 2 NPI-X excluded per protocol specification.
2. NPI-X (9 domains): total score = sum of (Frequency × Severity) across 9 behavioral domains. Range 0–108; higher score = greater behavioral disturbance.
3. b ANCOVA model: Mean NPI-X total (Wks 4–24) = Site + Treatment (continuous) + Baseline NPI-X total. Baseline = Visit 3 (Day ≤1).
4. Nominal p-values; no multiplicity adjustment.
5. Source: ADEFF, PARAMCD='NPIXTTL9', EFFFL='Y'. Mean computed over AVISITN 400–2400 (Weeks 4–24).

---

### T-17: Summary of Planned Exposure to Study Drug, as of End of Study

**Title:** Summary of Planned Exposure to Study Drug, as of End of Study
**Population:** Safety
**Layout:** Portrait
**ADaM Dataset(s):** ADEX or ADSL
**Page:** 14.3

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-17. Summary of Planned Exposure to Study Drug, as of End of Study
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

Average Daily Dose (mg/day)a
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

Cumulative Dose (mg)b
  N                                xxx              xxx              xxx
  Mean (SD)                        xxxx.x (xxx.xx)  xxxx.x (xxx.xx)  xxxx.x (xxx.xx)
  Median                           xxxx.x           xxxx.x           xxxx.x
  Min, Max                         xxx, xxxxx       xxx, xxxxx       xxx, xxxxx

Duration of Treatment (days)c
  N                                xxx              xxx              xxx
  Mean (SD)                        xxx.x (xx.xx)    xxx.x (xx.xx)    xxx.x (xx.xx)
  Median                           xxx.x            xxx.x            xxx.x
  Min, Max                         xx, xxx          xx, xxx          xx, xxx
```

**Footnotes:**
1. Safety population: all randomized patients who received at least one dose of study drug.
2. a Average daily dose = cumulative dose / duration of treatment in days.
3. b Cumulative dose calculated to Week 26 (Visit 13) or date of last dose, whichever is earlier.
4. c Duration of treatment = date of last dose – date of first dose + 1.
5. For high dose arm: dose escalation from 54mg to 81mg occurs at Week 8 (Visit 8). Cumulative dose accounts for the dose escalation schedule.
6. Source: ADEX (EXDOSE, EXSTDTC, EXENDTC) or ADSL derived exposure variables.

---

### T-18: Incidence of Treatment Emergent Adverse Events by Treatment Group

**Title:** Incidence of Treatment Emergent Adverse Events by Treatment Group
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADAE
**Page:** 14.3.1

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-18. Incidence of Treatment Emergent Adverse Events by Treatment Group
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

Any TEAE                           xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)

[Body System / System Organ Class]
  [Preferred Term]                 xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

CARDIAC DISORDERS
  Palpitations                     xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional PTs...]

GASTROINTESTINAL DISORDERS
  Nausea                           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Vomiting                         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Diarrhoea                        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Abdominal Pain                   xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional PTs...]

GENERAL DISORDERS AND ADMINISTRATION SITE CONDITIONS
  Application Site Erythema        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Application Site Pruritus        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional PTs...]

NERVOUS SYSTEM DISORDERS
  Dizziness                        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Headache                         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional PTs...]

SKIN AND SUBCUTANEOUS TISSUE DISORDERS
  Rash                             xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Pruritus                         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Dermatitis                       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional PTs...]

  [Repeat for all SOCs with at least 1 TEAE]

                                                  p-value vs. Placebo:
  Low Dose vs. Placebo (Fisher's)              x.xxxx
  High Dose vs. Placebo (Fisher's)                              x.xxxx
```

**Footnotes:**
1. Safety population: all randomized patients who took at least one dose of study drug.
2. TEAE defined as: AE starting on or after date of first dose; or AE starting before first dose and worsening after; or AE starting and resolving before first dose then recurring after first dose.
3. n (%) = number (percentage) of patients with at least one event in that SOC/PT. Patients with multiple events in the same PT counted once.
4. SOCs and PTs coded using MedDRA. Table sorted by SOC alphabetically; PTs sorted by descending total incidence.
5. P-values from Fisher's exact test comparing each active arm to placebo. Note: HLT and HLGT codes masked per SAP Section 15.5; only SOC, PT, and LLT available.
6. Source: ADAE, TRTEMFL='Y', SAFFL='Y'.

**Programming Notes:**
- ADAE variables: AEBODSYS (SOC), AEDECOD (PT), TRTEMFL='Y', SAFFL='Y', USUBJID, TRT01A.
- Count unique patients per PT per treatment arm.

---

### T-19: Incidence of Treatment Emergent Serious Adverse Events by Treatment Group

**Title:** Incidence of Treatment Emergent Serious Adverse Events by Treatment Group
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADAE
**Page:** 14.3.1

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-19. Incidence of Treatment Emergent Serious Adverse Events by Treatment Group
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

Any Treatment-Emergent SAE         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Resulted in Death                xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Resulted in Hospitalization      xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Life-threatening                 xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Resulted in Disability           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

SAEs by SOC and PT:
[CARDIAC DISORDERS]
  [Preferred Term]                 xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
[NERVOUS SYSTEM DISORDERS]
  [Preferred Term]                 xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [Repeat for all SOCs with SAE]

Fisher's Exact Test p-values (vs. Placebo):
  Any SAE — Low Dose vs. Placebo   x.xxxx
  Any SAE — High Dose vs. Placebo                                   x.xxxx
```

**Footnotes:**
1. SAE = serious adverse event meeting one or more regulatory criteria (death, hospitalization, life-threatening, disability, cancer, congenital anomaly, drug overdose, other significant event).
2. TEAE definition as per T-18. Only SAEs classified as TEAEs are included.
3. Patients with multiple SAEs in the same PT counted once per PT.
4. Source: ADAE, TRTEMFL='Y', AESER='Y', SAFFL='Y'.

---

### T-20: Summary Statistics for Continuous Laboratory Values

**Title:** Summary Statistics for Continuous Laboratory Values
**Population:** Safety
**Layout:** Landscape (one analyte per page or multiple pages)
**ADaM Dataset(s):** ADLB
**Page:** 14.3.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-20. Summary Statistics for Continuous Laboratory Values
Safety Population

Parameter: [ANALYTE NAME, Units]

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
Visit                               (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

Baseline (Week -2, Visit 1)a
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x
  Normal Range                     [xx.x – xx.x]

Week 2 (Visit 4)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx

Week 4 (Visit 5)
  [repeat pattern above]

Week 6 (Visit 7)
  [repeat]

Week 8 (Visit 8)
  [repeat]

Week 12 (Visit 9)
  [repeat]

Week 16 (Visit 10)
  [repeat]

Week 20 (Visit 11)
  [repeat]

Week 24 (Visit 12)
  [repeat]

Week 26 / End of Study (Visit 13)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.xx (xx.xxx)   xx.xx (xx.xxx)   xx.xx (xx.xxx)
  Median                           xx.xx            xx.xx            xx.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x
```

**Footnotes:**
1. a Baseline laboratory values from Visit 1 (Screening/Week -2), not Visit 3 (Randomization).
2. Laboratory analytes include hematology (CBC, differential) and clinical chemistry (liver enzymes, renal function, electrolytes, glucose, lipids, thyroid function, folate, B12).
3. Only CDISC common lab list analytes included per SAP Section 15.4.
4. Normal ranges are site/laboratory-specific; common reference range shown for context.
5. This table repeated for each analyte. Source: ADLB, SAFFL='Y', DTYPE='' (observed).

---

### T-21: Frequency of Normal and Abnormal (Beyond Normal Range) Laboratory Values During Treatment

**Title:** Frequency of Normal and Abnormal (Beyond Normal Range) Laboratory Values During Treatment
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADLB
**Page:** 14.3.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-21. Frequency of Normal and Abnormal (Beyond Normal Range) Laboratory Values During Treatment
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline      p-value      p-value
                                                  Low Dose TTS     High Dose TTS    Low vs.      High vs.
Parameter                           (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)   Placebo      Placebo

[ANALYTE 1 — units]
  No Abnormal Measurement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)     x.xxxx       x.xxxx
  ≥1 Abnormal Measurement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

[ANALYTE 2 — units]
  No Abnormal Measurement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)     x.xxxx       x.xxxx
  ≥1 Abnormal Measurement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

[Repeat for all analytes]
```

**Footnotes:**
1. Abnormal = value outside the normal reference range (below LLN or above ULN) during the post-randomization treatment period.
2. Patients with at least one post-baseline value available are included. Patients with no post-baseline values are excluded from numerator and denominator for that analyte.
3. P-values from Fisher's exact test comparing each active group to placebo.
4. Source: ADLB, SAFFL='Y', post-baseline visits (AVISITN > 0).

---

### T-22: Frequency of Normal and Abnormal (Clinically Significant Change from Previous Visit) Laboratory Values During Treatment

**Title:** Frequency of Normal and Abnormal (Clinically Significant Change from Previous Visit) Laboratory Values During Treatment
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADLB
**Page:** 14.3.2

*[Structure identical to T-21; "Abnormal" defined as clinically significant change from preceding scheduled visit rather than beyond normal range.]*

**Footnotes:**
1. Abnormal = clinically significant change from the prior scheduled laboratory visit, as assessed by the investigator or pre-specified threshold criteria.
2. See T-21 for general footnotes. P-values from Fisher's exact test. Source: ADLB, SAFFL='Y'.

---

### T-23: Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges, by Visit

**Title:** Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges, by Visit
**Population:** Safety
**Layout:** Landscape (one analyte × visit per page)
**ADaM Dataset(s):** ADLB
**Page:** 14.3.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-23. Shifts of Laboratory Values During Treatment, by Visit
Safety Population

Parameter: [ANALYTE NAME, Units]   Visit: [Week X, Visit Y]

                                          On-Treatment Categorya
                                   ─────────────────────────────────────────────────
Baseline Categorya               Below Normal    Normal       Above Normal     Total

Placebo TTS (N=xxx):
  Below Normal                    xx              xx           xx               xx
  Normal                          xx              xx           xx               xx
  Above Normal                    xx              xx           xx               xx
  Total                           xx              xx           xx               xx

Xanomeline Low Dose TTS 54mg (N=xxx):
  Below Normal                    xx              xx           xx               xx
  Normal                          xx              xx           xx               xx
  Above Normal                    xx              xx           xx               xx
  Total                           xx              xx           xx               xx

Xanomeline High Dose TTS 81mg (N=xxx):
  Below Normal                    xx              xx           xx               xx
  Normal                          xx              xx           xx               xx
  Above Normal                    xx              xx           xx               xx
  Total                           xx              xx           xx               xx
```

**Footnotes:**
1. a Category definitions: Below Normal = value < LLN; Normal = LLN ≤ value ≤ ULN; Above Normal = value > ULN. Normal ranges are laboratory- and site-specific.
2. Baseline category based on Visit 1 (Screening/Week -2) value.
3. This table is generated for each analyte × each scheduled post-baseline visit (Weeks 2, 4, 6, 8, 12, 16, 20, 24, 26).
4. Source: ADLB, SAFFL='Y'. Baseline: ABLFL='Y' (Visit 1). On-treatment: AVISITN > 0.

---

### T-24: Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges (Overall)

**Title:** Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADLB
**Page:** 14.3.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-24. Shifts of Laboratory Values During Treatment (Overall Worst-Case)
Safety Population

                                          Worst On-Treatment Categorya
                                   ─────────────────────────────────────────────────────────────
                                        Placebo TTS           Low Dose TTS        High Dose TTS
Parameter          Baseline          ─────────────────────────────────────────────────────────
                   Category        BL    NL    AL    p-CMHb  BL    NL    AL     BL    NL    AL    p-CMHb

[ANALYTE 1]
                   Below Normal    xx    xx    xx            xx    xx    xx     xx    xx    xx
                   Normal          xx    xx    xx            xx    xx    xx     xx    xx    xx
                   Above Normal    xx    xx    xx            xx    xx    xx     xx    xx    xx
```

**Footnotes:**
1. a Worst-case overall on-treatment categorization: patients assigned to their worst (most extreme) category observed across all post-baseline visits.
2. b CMH test (Cochran-Mantel-Haenszel) stratified by baseline laboratory category, comparing each active group to placebo.
3. BL=Below Normal, NL=Normal, AL=Above Normal.
4. Source: ADLB, worst-case flag or derived WORST='Y' across post-baseline visits, SAFFL='Y'.

---

### T-25: Shifts of Hy's Law Values During Treatment

**Title:** Shifts of Hy's Law Values During Treatment
**Population:** Safety
**Layout:** Portrait
**ADaM Dataset(s):** ADLB
**Page:** 14.3.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-25. Shifts of Hy's Law Values During Treatment
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

Transaminase (ALT or AST)a
  Normal at Baseline, Normal On-Treatment    xx (xx.x%)  xx (xx.x%)  xx (xx.x%)
  Normal at Baseline, Abnormal On-Treatment  xx (xx.x%)  xx (xx.x%)  xx (xx.x%)
  Abnormal at Baseline, Normal On-Treatment  xx (xx.x%)  xx (xx.x%)  xx (xx.x%)
  Abnormal at Baseline, Abnormal On-Treatment xx (xx.x%) xx (xx.x%)  xx (xx.x%)

Total Bilirubin
  Normal at Baseline, Normal On-Treatment    xx (xx.x%)  xx (xx.x%)  xx (xx.x%)
  Normal at Baseline, Abnormal On-Treatment  xx (xx.x%)  xx (xx.x%)  xx (xx.x%)
  Abnormal at Baseline, Normal On-Treatment  xx (xx.x%)  xx (xx.x%)  xx (xx.x%)
  Abnormal at Baseline, Abnormal On-Treatment xx (xx.x%) xx (xx.x%)  xx (xx.x%)

Hy's Law Cases (Combined)b
  Potential Hy's Law Case           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
```

**Footnotes:**
1. a Abnormal transaminase = ALT or AST > 1.5 × ULN during treatment.
2. b Potential Hy's Law case = patient with both transaminase > 1.5 × ULN AND total bilirubin > 1.5 × ULN at any post-baseline visit.
3. Baseline = Visit 1 (Screening/Week -2). Normal/abnormal classification based on lab-specific ULN.
4. Source: ADLB, SAFFL='Y'. Parameters: ALT (LBTEST='Alanine Aminotransferase'), AST, Bilirubin Total.

---

### T-26: Summary of Vital Signs at Baseline and End of Treatment

**Title:** Summary of Vital Signs at Baseline and End of Treatment
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADVS
**Page:** 14.3.3

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-26. Summary of Vital Signs at Baseline and End of Treatment
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
Parameter / Visit                   (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

SYSTOLIC BLOOD PRESSURE – SUPINE (mmHg)
  Baseline (Visit 3)
    N                              xxx              xxx              xxx
    Mean (SD)                      xxx.x (xx.xx)    xxx.x (xx.xx)    xxx.x (xx.xx)
    Median (Min, Max)              xxx.x (xxx, xxx) xxx.x (xxx, xxx) xxx.x (xxx, xxx)
  End of Treatmenta (Week 24 or last visit)
    N                              xxx              xxx              xxx
    Mean (SD)                      xxx.x (xx.xx)    xxx.x (xx.xx)    xxx.x (xx.xx)

DIASTOLIC BLOOD PRESSURE – SUPINE (mmHg)
  Baseline / End of Treatment: [same structure as above]

SYSTOLIC BLOOD PRESSURE – STANDING 1 MIN (mmHg)
  Baseline / End of Treatment: [same structure]

DIASTOLIC BLOOD PRESSURE – STANDING 1 MIN (mmHg)
  Baseline / End of Treatment: [same structure]

SYSTOLIC BLOOD PRESSURE – STANDING 3 MIN (mmHg)
  Baseline / End of Treatment: [same structure]

DIASTOLIC BLOOD PRESSURE – STANDING 3 MIN (mmHg)
  Baseline / End of Treatment: [same structure]

HEART RATE – SUPINE (bpm)
  Baseline / End of Treatment: [same structure]

HEART RATE – STANDING 1 MIN (bpm)
  Baseline / End of Treatment: [same structure]

HEART RATE – STANDING 3 MIN (bpm)
  Baseline / End of Treatment: [same structure]
```

**Footnotes:**
1. a End of treatment = last scheduled vital sign assessment on or before Week 24 (Visit 12) for completers; last available on-treatment assessment for early terminators.
2. Vital signs collected at each scheduled visit. Standing measurements taken at 1 and 3 minutes post standing.
3. Source: ADVS, SAFFL='Y'. Parameters: SYSBP_SUP, DIABP_SUP, SYSBP_STAND1, DIABP_STAND1, SYSBP_STAND3, DIABP_STAND3, PULSE_SUP, PULSE_STAND1, PULSE_STAND3.

---

### T-27: Summary of Vital Signs Change From Baseline at End of Treatment

**Title:** Summary of Vital Signs Change From Baseline at End of Treatment
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADVS
**Page:** 14.3.3

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-27. Summary of Vital Signs Change From Baseline at End of Treatment
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
Parameter                           (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

SYSTOLIC BLOOD PRESSURE – SUPINE (mmHg)
  N                                xxx              xxx              xxx
  Mean Change (SD)                 x.xx (xx.xxx)    x.xx (xx.xxx)    x.xx (xx.xxx)
  Median Change                    x.xx             x.xx             x.xx
  Min, Max Change                  xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

DIASTOLIC BLOOD PRESSURE – SUPINE (mmHg)   [same structure]
SYSTOLIC BP – STANDING 1 MIN (mmHg)        [same structure]
DIASTOLIC BP – STANDING 1 MIN (mmHg)       [same structure]
SYSTOLIC BP – STANDING 3 MIN (mmHg)        [same structure]
DIASTOLIC BP – STANDING 3 MIN (mmHg)       [same structure]
HEART RATE – SUPINE (bpm)                  [same structure]
HEART RATE – STANDING 1 MIN (bpm)          [same structure]
HEART RATE – STANDING 3 MIN (bpm)          [same structure]
```

**Footnotes:**
1. Change from baseline = End of Treatment value – Baseline value (Visit 3 for all vital signs except height).
2. End of treatment as defined in T-26 footnote 1.
3. Source: ADVS, CHG variable, SAFFL='Y'.

---

### T-28: Summary of Weight Change From Baseline at End of Treatment

**Title:** Summary of Weight Change From Baseline at End of Treatment
**Population:** Safety
**Layout:** Portrait
**ADaM Dataset(s):** ADVS or ADSL
**Page:** 14.3.3

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-28. Summary of Weight Change From Baseline at End of Treatment
Safety Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

WEIGHT AT BASELINE (kg)
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)
  Median (Min, Max)                xx.x (xx.x, xxx.x) xx.x (xx.x, xxx.x) xx.x (xx.x, xxx.x)

WEIGHT AT WEEK 24 (kg)
(Including Early Terminations)a
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)

CHANGE FROM BASELINE IN WEIGHT
(Including Early Terminations)
  N                                xxx              xxx              xxx
  Mean (SD)                        x.xx (xx.xx)     x.xx (xx.xx)     x.xx (xx.xx)
  Median                           x.xx             x.xx             x.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x

WEIGHT AT WEEK 24 (kg)
(Completers Only)b
  N                                xxx              xxx              xxx
  Mean (SD)                        xx.x (xx.xx)     xx.x (xx.xx)     xx.x (xx.xx)

CHANGE FROM BASELINE IN WEIGHT
(Completers Only)
  N                                xxx              xxx              xxx
  Mean (SD)                        x.xx (xx.xx)     x.xx (xx.xx)     x.xx (xx.xx)
  Median                           x.xx             x.xx             x.xx
  Min, Max                         xx.x, xx.x       xx.x, xx.x       xx.x, xx.x
```

**Footnotes:**
1. a Including early terminations: Week 24 weight is the last available weight measurement on or before Week 24 for patients who did not complete Week 24.
2. b Completers only: patients who completed the Week 24 visit (Visit 12).
3. Baseline weight from Visit 3 (Randomization/Week 0).
4. Source: ADVS (PARAMCD='WEIGHT') or ADSL (WEIGHTBL, WEIGHTEND), SAFFL='Y'.

---

### T-29: Summary of Concomitant Medications (Number of Subjects)

**Title:** Summary of Concomitant Medications (Number of Subjects)
**Population:** All Subjects
**Layout:** Portrait (may span multiple pages)
**ADaM Dataset(s):** ADCM
**Page:** 14.5

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-29. Summary of Concomitant Medications (Number of Subjects)
All Subjects (Safety Population)

                                   Placebo TTS      Xanomeline       Xanomeline       Total
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)    (N=xxx)

Any Concomitant Medication         xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)      xxx (xx.x%)

[ATC LEVEL 1 BODY SYSTEM]
  [Generic Ingredient Name]        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)

NERVOUS SYSTEM
  Donepezil                        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Rivastigmine                     xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  Memantine                        xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional drugs...]

CARDIOVASCULAR SYSTEM
  [Generic Name]                   xx (xx.x%)       xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  [additional drugs...]

[Repeat for all ATC Level 1 categories with ≥1 subject]
```

**Footnotes:**
1. Concomitant medications include any medication taken concurrently with study drug during the treatment period.
2. Medications coded using WHO Drug dictionary (ATC Level 1 Body System and generic ingredient).
3. n (%) = number (percentage) of patients who received each medication. Patients receiving the same medication more than once counted once.
4. Table sorted by ATC Level 1 alphabetically; within each ATC Level 1, generic ingredients sorted by descending total incidence.
5. Source: ADCM, SAFFL='Y', on-treatment period.

---

### T-AH01: CIBIC+ – Categorical Analysis – LOCF (Ad hoc)

**Title:** CIBIC+ – Categorical Analysis – LOCF (Ad hoc, FDA Request)
**Population:** Efficacy
**Layout:** Landscape
**ADaM Dataset(s):** ADEFF
**Page:** 14.2 (Appendix / Ad hoc)

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Table T-AH01. CIBIC+ – Categorical Analysis – LOCF (Ad hoc)
Efficacy Population

                                   Placebo TTS      Xanomeline       Xanomeline
                                                  Low Dose TTS     High Dose TTS
                                    (N=xxx)        54 mg (N=xxx)    81 mg (N=xxx)

WEEK 8 (Visit 8)
  N                                xxx              xxx              xxx
  1 – Marked Improvement           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  2 – Moderate Improvement         xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  3 – Minimal Improvement          xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  4 – No Change                    xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  5 – Minimal Worsening            xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  6 – Moderate Worsening           xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  7 – Marked Worsening             xx (xx.x%)       xx (xx.x%)       xx (xx.x%)
  CMH p-value (vs. Placebo):a
    Low Dose vs. Placebo                            x.xxxx
    High Dose vs. Placebo                                            x.xxxx

WEEK 16 (Visit 10)
  N                                xxx              xxx              xxx
  [1–7 distribution as above]
  CMH p-value (vs. Placebo):
    Low Dose vs. Placebo                            x.xxxx
    High Dose vs. Placebo                                            x.xxxx

WEEK 24 (Visit 12) [Primary Endpoint Visit]
  N                                xxx              xxx              xxx
  [1–7 distribution as above]
  CMH p-value (vs. Placebo):
    Low Dose vs. Placebo                            x.xxxx
    High Dose vs. Placebo                                            x.xxxx
```

**Footnotes:**
1. This ad hoc analysis was not pre-specified in the original protocol. Results provided at the request of FDA reviewers. Reference: SAP Appendix 3.
2. a CMH test (Cochran-Mantel-Haenszel), Pearson Chi-Square, stratified by site, comparing distribution of CIBIC+ categories between each active group and placebo.
3. LOCF imputation applied at each visit using windowed assessments (Week 8: Day 2–84; Week 16: Day 85–140; Week 24: Day >140).
4. Source: ADEFF, PARAMCD='CIBICPLS', AVISITN=800/1600/2400, DTYPE='LOCF', EFFFL='Y'.

---

## Listing Shells

No listings are included in the CDISC SAP pilot project TLG plan (SAP Section 13.1). Listings would be defined separately for the full legacy submission. Standard listing shells to consider for a complete submission would include:

- L-16.1.1: Patient Disposition (demographic listing)
- L-16.2.1: ADAS-Cog (11) data by patient by visit
- L-16.2.2: CIBIC+ data by patient by visit
- L-16.2.3: NPI-X data by patient by visit
- L-16.3.1: Adverse event listing by patient (all AEs)
- L-16.3.2: Serious adverse event narrative listing
- L-16.3.3: Deaths listing
- L-16.3.4: Premature discontinuations due to AE listing
- L-16.3.5: Significant laboratory abnormality listing
- L-16.3.6: Dermatological adverse event listing (special interest)

---

## Figure Shells

---

### F-01: Time to First Dermatological Event by Treatment Group

**Title:** Time to First Dermatological Event by Treatment Group
**Population:** Safety
**Layout:** Landscape
**ADaM Dataset(s):** ADTTE (derived from ADAE)
**Page:** 15.2

```
Study: CDISCPILOT01                                                    Page x of x
Protocol: H2Q-MC-LZZT(c)

Figure F-01. Kaplan-Meier Estimates of Time to First Dermatological Adverse Event by Treatment Group
Safety Population

Y-axis: Survival Function (Proportion Without Dermatological Event)
        Scale: 0.0 to 1.0 (linear), labeled at 0.0, 0.2, 0.4, 0.6, 0.8, 1.0
        Title: "Proportion Without Dermatological Event"

X-axis: Time from First Dose (Days)
        Scale: 0 to 182 (Days 0 to 182), labeled at 0, 28, 56, 84, 112, 140, 168, 182
        Title: "Days from First Dose"

Curves:
  — Solid line:    Placebo TTS (N=xxx)
  — Dashed line:   Xanomeline Low Dose TTS 54mg (N=xxx)
  — Dotted line:   Xanomeline High Dose TTS 81mg (N=xxx)

Censoring marks: Vertical tick marks (|) at censoring times on each curve.

Number at Risk Table (below figure):
                           Day 0   Day 28   Day 56  Day 84  Day 112  Day 140  Day 168
Placebo TTS                 xxx      xxx      xxx     xxx     xxx      xxx      xxx
Xanomeline Low Dose 54mg    xxx      xxx      xxx     xxx     xxx      xxx      xxx
Xanomeline High Dose 81mg   xxx      xxx      xxx     xxx     xxx      xxx      xxx

Summary Statistics (inset or separate panel):
                            Placebo TTS    Low Dose TTS    High Dose TTS
  Events, n (%)             xx (xx.x%)     xx (xx.x%)      xx (xx.x%)
  Median time to event (days) xx.x (95% CI: xx.x, xx.x)   xx.x (...)   xx.x (...)
  Patients censored         xx             xx              xx
```

**Footnotes:**
1. Dermatological adverse events of special interest include MedDRA preferred terms related to rash, pruritus, dermatitis contact, and other dermatological reactions as identified by medical review of blinded coded AE terms.
2. KM survival function plotted. Event = first dermatological TEAE after date of first dose. Patients without a dermatological event are censored at their last known contact date on or before end of treatment.
3. Three separate KM curves displayed. Log-rank test or Wilcoxon test may be added for pairwise comparison of active vs. placebo groups.
4. Number at risk table placed below figure.
5. Source: ADTTE (parameter: time to first dermatological event), SAFFL='Y'. Derived from ADAE with TRTEMFL='Y' and dermatological event flag.

**Programming Notes:**
- Derive ADTTE record with PARAMCD='TTDERM': AVAL = days from first dose to first dermatological AE (if event) or to last on-treatment date (if censored). CNSR=0 for event, CNSR=1 for censored.
- KM curve via SAS PROC LIFETEST or R survfit().
- Dermatological PT list: obtain from medical review of blinded terms; likely includes Rash, Pruritus, Dermatitis Contact, Erythema, Urticaria, Skin Irritation (application site).

---

## Appendix: TLG Coverage Map

| Endpoint / Domain | Primary Table | Supporting Tables | Figure |
|---|---|---|---|
| ADAS-Cog (11) at Week 24 | T-05 | T-07, T-09, T-11, T-12, T-13, T-14, T-15 | — |
| CIBIC+ at Week 24 | T-06 | T-08, T-10, T-AH01 | — |
| NPI-X Mean Wks 4–24 | T-16 | — | — |
| Treatment-Emergent AEs | T-18 | — | — |
| Serious AEs | T-19 | — | — |
| Dermatological AEs | T-18 | — | F-01 |
| Laboratory (continuous) | T-20 | T-21, T-22, T-23, T-24, T-25 | — |
| Vital Signs | T-26, T-27 | T-28 (weight) | — |
| Exposure | T-17 | — | — |
| Concomitant Medications | T-29 | — | — |
| Demographics/Baseline | T-03 | T-04 | — |
| Populations / Disposition | T-01, T-02 | — | — |

**Coverage Notes:**
- PK analyses not performed in CDISC pilot (SAP Section 15.2); no PK TLGs generated.
- ECG analyses not performed in pilot (SAP Section 15.3); no ECG TLGs generated.
- DAD and ADAS-Cog (14) not analyzed in pilot (SAP Section 15.1 deviation); not included.
- ApoE genotype subgroup analysis not performed (SAP Section 15.1 deviation); not included.
- Interim analysis tables not applicable (no interims performed in pilot).
