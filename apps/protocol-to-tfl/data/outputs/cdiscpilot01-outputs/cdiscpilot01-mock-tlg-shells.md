# Mock TLG Shells — CDISCPILOT01: Xanomeline TTS in Alzheimer's Disease

## Generation metadata

- Source: outputs/cdiscpilot01/cdiscpilot01-trial-metadata.json
- Generated: 2026-03-06
- Phase: Phase III
- Design: Randomized, double-blind, placebo-controlled, parallel-group
- Arms: 3 (Placebo, Xanomeline Low Dose 54mg, Xanomeline High Dose 81mg)
- Total TLGs: 30 (Tables: 29, Listings: 0, Figures: 1)

---

## TLG Index

### Tables

| ID | Title | Population | Template |
|----|-------|------------|----------|
| T-1 | Summary of Populations | All Subjects | 1 |
| T-2 | Summary of End of Study Data | ITT | 2 |
| T-3 | Summary of Demographic and Baseline Characteristics | ITT | 3 |
| T-4 | Summary of Number of Subjects by Site | Safety | 4 |
| T-5 | Primary Endpoint Analysis: ADAS Cog (11) - Change from Baseline to Week 24 - LOCF | Efficacy | 5 |
| T-6 | Primary Endpoint Analysis: CIBIC+ - Summary at Week 24 - LOCF | Efficacy | 6 |
| T-7 | ADAS Cog (11) - Change from Baseline to Week 8 - LOCF | Efficacy | 5 |
| T-8 | CIBIC+ - Summary at Week 8 - LOCF | Efficacy | 6 |
| T-9 | ADAS Cog (11) - Change from Baseline to Week 16 - LOCF | Efficacy | 5 |
| T-10 | CIBIC+ - Summary at Week 16 - LOCF | Efficacy | 6 |
| T-11 | ADAS Cog (11) - Change from Baseline to Week 24 - Completers - Observed Cases | Efficacy (Completers) | 7 |
| T-12 | ADAS Cog (11) - Change from Baseline to Week 24 in Male Subjects - LOCF | Efficacy (Males) | 8 |
| T-13 | ADAS Cog (11) - Change from Baseline to Week 24 in Female Subjects - LOCF | Efficacy (Females) | 8 |
| T-14 | ADAS Cog (11) - Mean and Mean Change from Baseline over Time | Efficacy | 9 |
| T-15 | ADAS Cog (11) - Repeated Measures Analysis of Change from Baseline to Week 24 | Efficacy | 10 |
| T-16 | Mean NPI-X Total Score from Week 4 through Week 24 - Windowed | Efficacy | 11 |
| T-17 | Summary of Planned Exposure to Study Drug, as of End of Study | Safety | 12 |
| T-18 | Incidence of Treatment Emergent Adverse Events by Treatment Group | Safety | 13 |
| T-19 | Incidence of Treatment Emergent Serious Adverse Events by Treatment Group | Safety | 14 |
| T-20 | Summary Statistics for Continuous Laboratory Values | Safety | 15 |
| T-21 | Frequency of Normal and Abnormal (Beyond Normal Range) Laboratory Values During Treatment | Safety | 16 |
| T-22 | Frequency of Normal and Abnormal (Clinically Significant Change) Laboratory Values During Treatment | Safety | 17 |
| T-23 | Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges, by Visit | Safety | 18 |
| T-24 | Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges | Safety | 19 |
| T-25 | Shifts of Hy's Law Values During Treatment | Safety | 20 |
| T-26 | Summary of Vital Signs at Baseline and End of Treatment | Safety | 21 |
| T-27 | Summary of Vital Signs Change From Baseline at End of Treatment | Safety | 22 |
| T-28 | Summary of Weight Change From Baseline at End of Treatment | Safety | 23 |
| T-29 | Summary of Concomitant Medications (Number of Subjects) | Safety | 24 |

### Figures

| ID | Title | Population |
|----|-------|------------|
| F-1 | Time to First Dermatological Event by Treatment Group | Safety |

---

## Table Shells

---

### Table T-1: Summary of Populations

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: All Subjects

                              Summary of Populations

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose       Total
Population                               (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————————————
Intent-to-Treat (ITT)                   xxx (xx%)      xxx (xx%)      xxx (xx%)      xxx (xx%)
Safety                                  xxx (xx%)      xxx (xx%)      xxx (xx%)      xxx (xx%)
Efficacy                                xxx (xx%)      xxx (xx%)      xxx (xx%)      xxx (xx%)
Completer Week 24                       xxx (xx%)      xxx (xx%)      xxx (xx%)      xxx (xx%)
Complete Study                          xxx (xx%)      xxx (xx%)      xxx (xx%)      xxx (xx%)
———————————————————————————————————————————————————————————————————————————————————————————————

NOTE: N in column headers represents number of subjects entered in study (i.e., signed
informed consent). The ITT population includes all subjects randomized. The Safety
population includes all randomized subjects known to have taken at least one dose of
randomized study drug. The Efficacy population includes all subjects in the safety
population who also have at least one post-baseline ADAS-Cog and CIBIC+ assessment.

Source: ADSL
Program: t_pop.sas
```

**Programming notes:** Dataset: ADSL. Key variables: ITTFL, SAFFL, EFFFL, COMP24FL, COMP26FL. Denominator N = all entered subjects. Percentages based on entered subjects per arm.

---

### Table T-2: Summary of End of Study Data

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Intent-to-Treat

                           Summary of End of Study Data

                                                Placebo    Xanomeline   Xanomeline
                                                           Low Dose     High Dose     Total
                                                (N=xxx)    (N=xxx)      (N=xxx)      (N=xxx)
——————————————————————————————————————————————————————————————————————————————————————————————
Completion Status
  Completed Week 24                           xx (xx.x)   xx (xx.x)   xx (xx.x)   xx (xx.x)   p-value[1]
  Early Termination (prior to Week 24)        xx (xx.x)   xx (xx.x)   xx (xx.x)
  Missing                                     xx (xx.x)   xx (xx.x)   xx (xx.x)

Reason for Early Termination (prior to Week 24)
  Adverse event                               xx (xx.x)   xx (xx.x)   xx (xx.x)   xx (xx.x)   p-value
  Death                                       xx (xx.x)   xx (xx.x)   xx (xx.x)
  Lack of efficacy [2]                        xx (xx.x)   xx (xx.x)   xx (xx.x)   xx (xx.x)   p-value
  Lost to follow-up                           xx (xx.x)   xx (xx.x)   xx (xx.x)
  Subject decided to withdraw                 xx (xx.x)   xx (xx.x)   xx (xx.x)
  Physician decided to withdraw subject       xx (xx.x)   xx (xx.x)   xx (xx.x)
  Protocol criteria not met                   xx (xx.x)   xx (xx.x)   xx (xx.x)
  Protocol violation                          xx (xx.x)   xx (xx.x)   xx (xx.x)
  Sponsor decision                            xx (xx.x)   xx (xx.x)   xx (xx.x)
  Missing                                     xx (xx.x)   xx (xx.x)   xx (xx.x)
——————————————————————————————————————————————————————————————————————————————————————————————

[1] Fisher's exact test.
[2] Based on either patient/caregiver perception or physician perception.

Abbreviations: N = number of subjects in population; n = number of subjects in category.
Source: ADSL
Program: t_eos.sas
```

**Programming notes:** Dataset: ADSL. Key variables: EOSSTT, DCSREAS. Fisher's exact test for 3 reasons: protocol completed, lack of efficacy, and adverse event.

---

### Table T-3: Summary of Demographic and Baseline Characteristics

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Intent-to-Treat

              Summary of Demographic and Baseline Characteristics

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose       Total
                                         (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)     p-value
——————————————————————————————————————————————————————————————————————————————————————————————————————————
Age (years)
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)  x.xxx[1]
  Median                                  xx.x           xx.x           xx.x           xx.x
  Min, Max                              xx, xx         xx, xx         xx, xx         xx, xx

Age category, n (%)
  <65                                   xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)     x.xxx[2]
  65-80                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  >80                                   xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Sex, n (%)
  Female                                xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)     x.xxx[2]
  Male                                  xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Race, n (%)
  White                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)     x.xxx[2]
  Black or African American             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  American Indian or Alaska Native      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Mini-Mental State (MMSE)
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)  x.xxx[3]
  Median                                  xx.x           xx.x           xx.x           xx.x
  Min, Max                              xx, xx         xx, xx         xx, xx         xx, xx

Duration of disease (months)
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)  x.xxx[1]
  Median                                  xx.x           xx.x           xx.x           xx.x
  Min, Max                              xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x

Years of education
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)  x.xxx[1]
  Median                                  xx.x           xx.x           xx.x           xx.x
  Min, Max                              xx, xx         xx, xx         xx, xx         xx, xx

Weight (kg)
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)  x.xxx[1]
  Median                                  xx.x           xx.x           xx.x           xx.x
  Min, Max                              xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x

Height (cm)
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                            xxx.x (xx.xx)  xxx.x (xx.xx)  xxx.x (xx.xx)  xxx.x (xx.xx)  x.xxx[1]

BMI (kg/m2)
  n                                        xxx            xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)  x.xxx[1]
  Median                                  xx.x           xx.x           xx.x           xx.x
  Min, Max                              xx.x, xx.x    xx.x, xx.x    xx.x, xx.x    xx.x, xx.x

BMI category, n (%)
  BMI<25                                xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)     x.xxx[2]
  BMI 25-<30                            xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  BMI>=30                               xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
——————————————————————————————————————————————————————————————————————————————————————————————————————————

[1] ANOVA.
[2] Pearson's chi-square test.
[3] ANOVA with treatment and site as main effects.

Abbreviations: BMI = body mass index; Max = maximum; Min = minimum; MMSE = Mini-Mental
State Examination; N = number of subjects in population; n = number of subjects in
category; SD = standard deviation.

Note: Duration of disease = months between date of Week -2 (Visit 1) and date of onset
of the first definite symptoms of Alzheimer's Disease. Weight baseline at Visit 3;
Height baseline at Visit 1.

Source: ADSL
Program: t_demo.sas
```

---

### Table T-4: Summary of Number of Subjects by Site

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

                      Summary of Number of Subjects by Site

                                         Placebo        Xanomeline     Xanomeline
Pooled Site                                              Low Dose       High Dose       Total
——————————————————————————————————————————————————————————————————————————————————————————
Site xxx                                   xx              xx              xx             xx
Site xxx                                   xx              xx              xx             xx
...
——————————————————————————————————————————————————————————————————————————————————————————
Total                                      xxx             xxx             xxx            xxx
——————————————————————————————————————————————————————————————————————————————————————————

Note: Sites with fewer than 3 patients in any treatment group were pooled per SAP
Section 7.1.

Source: ADSL
Program: t_site.sas
```

---

### Table T-5: Primary Endpoint Analysis: ADAS Cog (11) - Change from Baseline to Week 24 - LOCF

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy

     Primary Endpoint Analysis: ADAS Cog (11) - Change from Baseline to Week 24 - LOCF

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Baseline
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Week 24 (LOCF)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Change from Baseline
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

ANCOVA Results [1]
  LS Mean                                xx.xx          xx.xx          xx.xx
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

  Dose-response test p-value [2]                                        x.xxxx

Pairwise comparisons [3]
  Xan Low - Placebo
    LS Mean difference (SE)                             xx.xx (xx.xxx)
    95% CI                                           (xx.xx, xx.xx)
    p-value                                              x.xxxx

  Xan High - Placebo
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    95% CI                                                          (xx.xx, xx.xx)
    p-value                                                             x.xxxx

  Xan High - Xan Low
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    95% CI                                                          (xx.xx, xx.xx)
    p-value                                                             x.xxxx
———————————————————————————————————————————————————————————————————————————————————————

[1] ANCOVA model with baseline ADAS-Cog (11) score, pooled site, and treatment
    (as continuous variable) as independent variables.
[2] Treatment included as continuous variable (dose-response test).
[3] Pairwise comparisons performed only if dose-response test is statistically
    significant (p<0.05). Two-sided tests at significance level 0.05.

Abbreviations: ADAS-Cog = Alzheimer's Disease Assessment Scale - Cognitive Subscale;
ANCOVA = analysis of covariance; CI = confidence interval; LOCF = last observation
carried forward; LS = least squares; N = number of subjects in population;
n = number of subjects with data; SD = standard deviation; SE = standard error.

Source: ADQSADAS
Program: t_adas_ancova.sas
```

**Programming notes:** Dataset: ADQSADAS (or ADQS with PARAMCD for ADAS-Cog(11)). Key variables: AVAL, BASE, CHG, TRTP, SITEGR1. LOCF imputation applied. Treatment coded as continuous: Placebo=0, Low=54, High=81 for dose-response test.

---

### Table T-6: Primary Endpoint Analysis: CIBIC+ - Summary at Week 24 - LOCF

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy

            Primary Endpoint Analysis: CIBIC+ - Summary at Week 24 - LOCF

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Week 24 (LOCF)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Median                                  x.xx           x.xx           x.xx
  Min, Max                              x, x           x, x           x, x

Frequency distribution, n (%)
  1 = Marked improvement                xx (xx.x)      xx (xx.x)      xx (xx.x)
  2 = Moderate improvement              xx (xx.x)      xx (xx.x)      xx (xx.x)
  3 = Minimal improvement               xx (xx.x)      xx (xx.x)      xx (xx.x)
  4 = No change                         xx (xx.x)      xx (xx.x)      xx (xx.x)
  5 = Minimal worsening                 xx (xx.x)      xx (xx.x)      xx (xx.x)
  6 = Moderate worsening                xx (xx.x)      xx (xx.x)      xx (xx.x)
  7 = Marked worsening                  xx (xx.x)      xx (xx.x)      xx (xx.x)

ANOVA Results [1]
  LS Mean                                xx.xx          xx.xx          xx.xx
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

  Dose-response test p-value [2]                                        x.xxxx

Pairwise comparisons [3]
  Xan Low - Placebo
    LS Mean difference (SE)                             xx.xx (xx.xxx)
    p-value                                              x.xxxx

  Xan High - Placebo
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    p-value                                                             x.xxxx

  Xan High - Xan Low
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    p-value                                                             x.xxxx
———————————————————————————————————————————————————————————————————————————————————————

[1] ANOVA model with pooled site and treatment (as continuous variable) as
    independent variables. No baseline covariate (CIBIC+ has no baseline score).
[2] Treatment included as continuous variable (dose-response test).
[3] Pairwise comparisons performed only if dose-response test is statistically
    significant (p<0.05). Two-sided tests at significance level 0.05.

Abbreviations: ANOVA = analysis of variance; CIBIC+ = Video-referenced Clinician's
Interview-based Impression of Change; CI = confidence interval; LOCF = last observation
carried forward; LS = least squares; N = number of subjects in population;
n = number of subjects with data; SD = standard deviation; SE = standard error.

Source: ADQSCIBC
Program: t_cibic_anova.sas
```

---

### Tables T-7 through T-10: Secondary Timepoint Analyses

Tables T-7 and T-9 follow the same structure as **Table T-5** (ADAS-Cog ANCOVA) but for **Week 8** and **Week 16** respectively.

Tables T-8 and T-10 follow the same structure as **Table T-6** (CIBIC+ ANOVA) but for **Week 8** and **Week 16** respectively.

---

### Table T-11: ADAS Cog (11) - Completers at Week 24 - Observed Cases

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy - Completers at Week 24

     ADAS Cog (11) - Change from Baseline to Week 24 - Completers - Observed Cases-Windowed

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Baseline
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Week 24 (Observed)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Change from Baseline
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

ANCOVA Results [1]
  LS Mean                                xx.xx          xx.xx          xx.xx
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

  Dose-response test p-value [2]                                        x.xxxx

Pairwise comparisons [3]
  Xan Low - Placebo
    LS Mean difference (SE)                             xx.xx (xx.xxx)
    95% CI                                           (xx.xx, xx.xx)
    p-value                                              x.xxxx

  Xan High - Placebo
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    95% CI                                                          (xx.xx, xx.xx)
    p-value                                                             x.xxxx

  Xan High - Xan Low
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    95% CI                                                          (xx.xx, xx.xx)
    p-value                                                             x.xxxx
———————————————————————————————————————————————————————————————————————————————————————

[1] ANCOVA model with baseline ADAS-Cog (11) score, pooled site, and treatment
    as independent variables. Observed data only (no LOCF imputation).
[2] Treatment as continuous variable (dose-response test).
[3] Pairwise comparisons at significance level 0.05, if dose-response is significant.

Note: Includes only completers who had an observed Week 24 assessment within the
assessment window (study day >140, target day 168).

Source: ADQSADAS
Program: t_adas_comp.sas
```

---

### Tables T-12 and T-13: ADAS Cog (11) by Gender Subgroup

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy - {Male / Female} Subjects

     ADAS Cog (11) - Change from Baseline to Week 24 in {Male / Female} Subjects - LOCF

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Baseline
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Week 24 (LOCF)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Change from Baseline
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

ANCOVA Results [1]
  LS Mean                                xx.xx          xx.xx          xx.xx
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

  Dose-response test p-value [2]                                        x.xxxx
———————————————————————————————————————————————————————————————————————————————————————

[1] ANCOVA model with baseline score, pooled site, and treatment as independent variables.
[2] Treatment as continuous variable.

Note: Subgroup analysis — {Male / Female} subjects only.

Source: ADQSADAS
Program: t_adas_gender.sas
```

---

### Table T-14: ADAS Cog (11) - Mean and Mean Change from Baseline over Time

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy

           ADAS Cog (11) - Mean and Mean Change from Baseline over Time

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
Visit                                    (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Baseline (Week 0)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Week 8
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Mean Change (SD)                      xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Week 16
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Mean Change (SD)                      xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Week 24
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Mean Change (SD)                      xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
———————————————————————————————————————————————————————————————————————————————————————

Note: LOCF imputation applied. Summary statistics generated for each visit.

Abbreviations: ADAS-Cog = Alzheimer's Disease Assessment Scale - Cognitive Subscale;
LOCF = last observation carried forward; N = number of subjects in population;
n = number of subjects with data; SD = standard deviation.

Source: ADQSADAS
Program: t_adas_time.sas
```

---

### Table T-15: ADAS Cog (11) - Repeated Measures Analysis (MMRM)

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy

     ADAS Cog (11) - Repeated Measures Analysis of Change from Baseline to Week 24

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Week 8
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Xan Low - Placebo (SE)                               xx.xx (xx.xxx)
    95% CI, p-value                                  (xx.xx, xx.xx)    x.xxxx
  Xan High - Placebo (SE)                                             xx.xx (xx.xxx)
    95% CI, p-value                                                 (xx.xx, xx.xx)    x.xxxx

Week 16
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Xan Low - Placebo (SE)                               xx.xx (xx.xxx)
    95% CI, p-value                                  (xx.xx, xx.xx)    x.xxxx
  Xan High - Placebo (SE)                                             xx.xx (xx.xxx)
    95% CI, p-value                                                 (xx.xx, xx.xx)    x.xxxx

Week 24
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)
  Xan Low - Placebo (SE)                               xx.xx (xx.xxx)
    95% CI, p-value                                  (xx.xx, xx.xx)    x.xxxx
  Xan High - Placebo (SE)                                             xx.xx (xx.xxx)
    95% CI, p-value                                                 (xx.xx, xx.xx)    x.xxxx
———————————————————————————————————————————————————————————————————————————————————————

[1] MMRM model: change from baseline in ADAS-Cog (11) as response. Fixed categorical
    effects: treatment, pooled site, time (week), treatment-by-time interaction.
    Continuous covariates: baseline ADAS-Cog (11), baseline-by-time interaction.
    Unstructured covariance matrix (Toeplitz if computational singularity).

Abbreviations: ADAS-Cog = Alzheimer's Disease Assessment Scale - Cognitive Subscale;
CI = confidence interval; LS = least squares; MMRM = mixed-effects model for
repeated measures; N = number of subjects; SE = standard error.

Source: ADQSADAS
Program: t_adas_mmrm.sas
```

---

### Table T-16: Mean NPI-X Total Score - Week 4 through Week 24

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Efficacy

         Mean NPI-X Total Score from Week 4 through Week 24 - Windowed

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Baseline (Week 0)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

Mean NPI-X Total Score (Week 4 to Week 24)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

ANCOVA Results [1]
  LS Mean                                xx.xx          xx.xx          xx.xx
  LS Mean (SE)                          xx.xx (xx.xxx) xx.xx (xx.xxx) xx.xx (xx.xxx)

  Dose-response test p-value [2]                                        x.xxxx

Pairwise comparisons [3]
  Xan Low - Placebo
    LS Mean difference (SE)                             xx.xx (xx.xxx)
    p-value                                              x.xxxx

  Xan High - Placebo
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    p-value                                                             x.xxxx

  Xan High - Xan Low
    LS Mean difference (SE)                                            xx.xx (xx.xxx)
    p-value                                                             x.xxxx
———————————————————————————————————————————————————————————————————————————————————————

[1] ANCOVA model with baseline NPI-X score, pooled site, and treatment as
    independent variables.
[2] Treatment as continuous variable (dose-response test).
[3] Pairwise comparisons at significance level 0.05, if dose-response is significant.

Note: NPI-X Total (9) = sum of frequency x severity for 9 domains (excluding sleep,
appetite, euphoria). Range 0-108. Endpoint = mean of all available total scores
between Weeks 4 and 24, inclusive. Assessment windows applied.

Abbreviations: ANCOVA = analysis of covariance; LS = least squares; N = number of
subjects; NPI-X = Revised Neuropsychiatric Inventory; SD = standard deviation;
SE = standard error.

Source: ADQSNPIX
Program: t_npix.sas
```

---

### Table T-17: Summary of Planned Exposure to Study Drug

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

         Summary of Planned Exposure to Study Drug, as of End of Study

                                         Placebo        Xanomeline     Xanomeline
                                                        Low Dose       High Dose
                                         (N=xxx)        (N=xxx)        (N=xxx)
———————————————————————————————————————————————————————————————————————————————————————
Average daily dose (mg)
  n                                        xxx            xxx            xxx
  Mean (SD)                             xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                  xx.x           xx.x           xx.x
  Min, Max                              xx.x, xx.x    xx.x, xx.x    xx.x, xx.x

Cumulative dose (mg)
  n                                        xxx            xxx            xxx
  Mean (SD)                           xxxx.x (xxxx.x) xxxx.x (xxxx.x) xxxx.x (xxxx.x)
  Median                                xxxx.x         xxxx.x         xxxx.x
  Min, Max                            xxx, xxxxx     xxx, xxxxx     xxx, xxxxx
———————————————————————————————————————————————————————————————————————————————————————

Note: Average daily dose and cumulative dose computed at end of study (Week 26 or
early termination).

Source: ADEX
Program: t_expo.sas
```

---

### Table T-18: Incidence of Treatment Emergent Adverse Events

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

         Incidence of Treatment Emergent Adverse Events by Treatment Group

                                              Placebo    Xanomeline   Xanomeline
System Organ Class                                       Low Dose     High Dose
  Preferred Term                              (N=xxx)    (N=xxx)      (N=xxx)      p-value[1]
——————————————————————————————————————————————————————————————————————————————————————————
Any Event                                   xxx (xx.x)  xxx (xx.x)  xxx (xx.x)

{SOC 1}                                      xx (xx.x)   xx (xx.x)   xx (xx.x)
  {PT 1}                                     xx (xx.x)   xx (xx.x)   xx (xx.x)    x.xxxx
  {PT 2}                                     xx (xx.x)   xx (xx.x)   xx (xx.x)    x.xxxx
  ...

{SOC 2}                                      xx (xx.x)   xx (xx.x)   xx (xx.x)
  {PT 1}                                     xx (xx.x)   xx (xx.x)   xx (xx.x)    x.xxxx
  ...
——————————————————————————————————————————————————————————————————————————————————————————

[1] Fisher's exact test comparing each active treatment group with placebo.

Note: TEAEs defined as events with start date on or after the date of first dose
(Week 0, Visit 3). A subject is counted once per SOC and once per PT. Events coded
using MedDRA. SOCs sorted alphabetically; PTs sorted by descending frequency
across treatment groups within SOC.

Abbreviations: MedDRA = Medical Dictionary for Regulatory Activities; N = number of
subjects in population; PT = preferred term; SOC = system organ class;
TEAE = treatment-emergent adverse event.

Source: ADAE
Program: t_ae_teae.sas
```

---

### Table T-19: Incidence of Treatment Emergent Serious Adverse Events

Same structure as **Table T-18** but restricted to **serious adverse events** only.

```
[Same column and row structure as T-18, filtered to AESER='Y']

Source: ADAE (where AESER='Y')
Program: t_ae_sae.sas
```

---

### Table T-20: Summary Statistics for Continuous Laboratory Values

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

             Summary Statistics for Continuous Laboratory Values

                                              Placebo (N=xxx)        Xanomeline Low (N=xxx)    Xanomeline High (N=xxx)
Laboratory Parameter / Visit                  n   Mean (SD)          n   Mean (SD)              n   Mean (SD)
——————————————————————————————————————————————————————————————————————————————————————————————————————————————————————
HEMATOLOGY

{Parameter, e.g., Hemoglobin (g/dL)}
  Baseline                                   xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 2                                     xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 4                                     xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 6                                     xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 8                                     xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 12                                    xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 16                                    xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 20                                    xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 24                                    xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)
  Week 26                                    xxx  xx.xx (xx.xxx)    xxx  xx.xx (xx.xxx)        xxx  xx.xx (xx.xxx)

CLINICAL CHEMISTRY
{Repeat for each analyte}
——————————————————————————————————————————————————————————————————————————————————————————————————————————————————————

Note: Baseline = Week -2 (Visit 1). Only planned laboratory values at scheduled visits
used. Statistics: n, mean, SD, median, min, max.

Source: ADLB
Program: t_lab_summ.sas
```

---

### Tables T-21 and T-22: Frequency of Abnormal Laboratory Values

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

   Frequency of Normal and Abnormal Laboratory Values During Treatment
   {T-21: Beyond Normal Range / T-22: Clinically Significant Change from Previous Visit}

                                              Placebo (N=xxx)        Xanomeline Low (N=xxx)    Xanomeline High (N=xxx)
                                              Normal   Abnormal     Normal   Abnormal          Normal   Abnormal
Laboratory Parameter                          n (%)    n (%)        n (%)    n (%)             n (%)    n (%)        p-value[1]
——————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————
{Parameter 1}
  No abnormal during treatment               xx (xx.x)              xx (xx.x)                  xx (xx.x)
  At least one abnormal during treatment
    Low                                      xx (xx.x)              xx (xx.x)                  xx (xx.x)              x.xxxx
    High                                     xx (xx.x)              xx (xx.x)                  xx (xx.x)              x.xxxx
...
——————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————

[1] Fisher's exact test comparing incidence of abnormal values.

Note: T-21 defines abnormal as beyond normal range (below LLN or above ULN).
T-22 defines abnormal as clinically significant change from previous visit (absolute
value of change from previous > 50% of normal range, ULN-LLN).

Source: ADLB
Program: t_lab_abn.sas
```

---

### Tables T-23 and T-24: Shift Tables for Laboratory Values

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

   Shifts of Laboratory Values During Treatment, Categorized Based on Threshold Ranges
   {T-23: by Visit / T-24: Overall (Baseline vs. Most Extreme On-Treatment)}

                                              On-Treatment
                              ————————————————————————————————————
Baseline Category               Low (L)      Normal (N)    High (H)     Total
——————————————————————————————————————————————————————————————————————————————
{Treatment: Placebo}
{Parameter, e.g., ALT (U/L)}
  Low (L)                       xx            xx            xx            xx
  Normal (N)                    xx            xx            xx            xx
  High (H)                      xx            xx            xx            xx
  Total                         xx            xx            xx            xx

{Treatment: Xanomeline Low Dose}
{Repeat}

{Treatment: Xanomeline High Dose}
{Repeat}
——————————————————————————————————————————————————————————————————————————————

Note: Categories defined relative to normal range: L = below LLN; N = within normal
range; H = above ULN. T-23 shows shifts by visit; T-24 shows baseline vs. most extreme
on-treatment value. Treatment period: Week 0 (Visit 3) through Week 24 (Visit 12).
CMH test stratified by baseline status.

Source: ADLB
Program: t_lab_shift.sas
```

---

### Table T-25: Shifts of Hy's Law Values During Treatment

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

                  Shifts of Hy's Law Values During Treatment

                                              On-Treatment
                              ————————————————————————————————————
Baseline Category               Normal         Abnormal          Total
——————————————————————————————————————————————————————————————————————————————
{Treatment: Placebo}
  Normal                         xx              xx                xx
  Abnormal                       xx              xx                xx
  Total                          xx              xx                xx

{Treatment: Xanomeline Low Dose}
  Normal                         xx              xx                xx
  Abnormal                       xx              xx                xx
  Total                          xx              xx                xx

{Treatment: Xanomeline High Dose}
  Normal                         xx              xx                xx
  Abnormal                       xx              xx                xx
  Total                          xx              xx                xx
——————————————————————————————————————————————————————————————————————————————

Note: Hy's Law criteria: Transaminase (SGPT/ALT or SGOT/AST) elevation >1.5*ULN
AND Bilirubin elevation >1.5*ULN.

Source: ADLB (Hy's Law dataset)
Program: t_hyslaw.sas
```

---

### Table T-26: Summary of Vital Signs at Baseline and End of Treatment

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

           Summary of Vital Signs at Baseline and End of Treatment

                                              Placebo        Xanomeline     Xanomeline
                                                             Low Dose       High Dose
Vital Sign Parameter                          (N=xxx)        (N=xxx)        (N=xxx)
——————————————————————————————————————————————————————————————————————————————————————————
Systolic BP Supine (mmHg)
  Baseline
    n / Mean (SD)                           xxx  xxx.x (xx.xx)  xxx  xxx.x (xx.xx)  xxx  xxx.x (xx.xx)
  End of Treatment
    n / Mean (SD)                           xxx  xxx.x (xx.xx)  xxx  xxx.x (xx.xx)  xxx  xxx.x (xx.xx)

Diastolic BP Supine (mmHg)
  {Same structure}

Systolic BP Standing 1 min (mmHg)
  {Same structure}

Diastolic BP Standing 1 min (mmHg)
  {Same structure}

Systolic BP Standing 3 min (mmHg)
  {Same structure}

Diastolic BP Standing 3 min (mmHg)
  {Same structure}

Heart Rate Supine (bpm)
  {Same structure}

Heart Rate Standing 1 min (bpm)
  {Same structure}

Heart Rate Standing 3 min (bpm)
  {Same structure}
——————————————————————————————————————————————————————————————————————————————————————————

Note: End of Treatment = last visit on or before Week 24. Statistics: n, mean, SD,
median, min, max.

Source: ADVS
Program: t_vs_summ.sas
```

---

### Table T-27: Summary of Vital Signs Change From Baseline

Same parameters as **Table T-26** but showing **change from baseline** at end of treatment.

---

### Table T-28: Summary of Weight Change From Baseline

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

           Summary of Weight Change From Baseline at End of Treatment

                                              Placebo        Xanomeline     Xanomeline
                                                             Low Dose       High Dose
                                              (N=xxx)        (N=xxx)        (N=xxx)
——————————————————————————————————————————————————————————————————————————————————————————
Including Early Terminations
  Baseline
    n / Mean (SD)                           xxx  xx.x (xx.xx)  xxx  xx.x (xx.xx)  xxx  xx.x (xx.xx)
  Week 24 / End of Treatment
    n / Mean (SD)                           xxx  xx.x (xx.xx)  xxx  xx.x (xx.xx)  xxx  xx.x (xx.xx)
  Change from Baseline
    n / Mean (SD)                           xxx  xx.x (xx.xx)  xxx  xx.x (xx.xx)  xxx  xx.x (xx.xx)

Excluding Early Terminations
  {Same structure, completers only}
——————————————————————————————————————————————————————————————————————————————————————————

Source: ADVS
Program: t_wt.sas
```

---

### Table T-29: Summary of Concomitant Medications

```
Protocol: CDISCPILOT01                                                    Page x of n
Population: Safety

              Summary of Concomitant Medications (Number of Subjects)

                                              Placebo        Xanomeline     Xanomeline
                                                             Low Dose       High Dose       Total
Body System / Ingredient                      (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
——————————————————————————————————————————————————————————————————————————————————————————————————
Any Concomitant Medication                  xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)

{Body System 1}                              xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  {Ingredient 1}                             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  {Ingredient 2}                             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  ...

{Body System 2}
  ...
——————————————————————————————————————————————————————————————————————————————————————————————————

Note: Medications coded using WHO Drug. Body Systems sorted by descending total
incidence; ingredients sorted by descending incidence within Body System.
Uncoded medications listed under "Uncoded". A subject counted once per ingredient.

Source: ADCM
Program: t_cm.sas
```

---

## Figure Shells

---

### Figure F-1: Time to First Dermatological Event by Treatment Group

```
Figure F-1
Time to First Dermatological Event by Treatment Group
Population: Safety — Study CDISCPILOT01

[Description]
X-axis: Time (weeks) from first dose (Week 0) to Week 26
Y-axis: Proportion of subjects without dermatological event (0.0 to 1.0)
Curves: Three Kaplan-Meier curves
  - Placebo (solid black line)
  - Xanomeline Low Dose (dashed blue line)
  - Xanomeline High Dose (dotted red line)
Censor marks: Tick marks at censoring times on each curve
Legend: Treatment arm names
Below plot: Number at Risk table by treatment group at Weeks 0, 4, 8, 12, 16, 20, 24

Note: Dermatological events defined by medical review of blinded coded AE terms.
All PTs considered dermatologic in nature (rash, pruritus, dermatitis, etc.) flagged
as AEs of special interest.

Source: ADAE (dermatological events), ADTTE
Program: f_derm_km.sas
```

---

## Gap Analysis

The planned TLG list from the SAP covers 29 tables and 1 figure. Comparing against the Phase III catalog, the following are **not included** but may be worth considering:

| Missing TLG | Reason | Recommendation |
|-------------|--------|----------------|
| Listings (Deaths, SAEs, AEs leading to D/C) | SAP does not include listings | Consider adding for completeness of submission package |
| CIBIC+ CMH Analysis (Ad hoc) | Requested by FDA (SAP Section 16.1) | Add as T-30 or Ad Hoc Table 1 |
| Medical History summary | Standard for Phase III | Not in SAP scope for this pilot |
| Protocol Deviations listing | Standard for Phase III | Not in SAP scope for this pilot |

The SAP explicitly notes this is a **pilot submission** with a representative subset of analyses, not a full submission package.
