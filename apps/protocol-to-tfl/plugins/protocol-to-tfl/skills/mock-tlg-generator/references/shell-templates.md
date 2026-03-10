# Mock TLG Shell Templates

This reference provides concrete templates for the most common TLG types. Use these as the structural basis when generating shells -- adapt column headers, row stubs, and footnotes to match the specific study's treatment arms, endpoints, and populations.

## Table of Contents

1. [Shell Format Conventions](#shell-format-conventions)
2. [Disposition](#disposition)
3. [Demographics and Baseline](#demographics-and-baseline)
4. [Drug Exposure](#drug-exposure)
5. [AE Overview Summary](#ae-overview-summary)
6. [TEAE by SOC/PT/Grade](#teae-by-socptgrade)
7. [Laboratory Shift Table](#laboratory-shift-table)
8. [Vital Signs by Visit](#vital-signs-by-visit)
9. [Time-to-Event KM Summary Table](#time-to-event-km-summary-table)
10. [Response Rate Table](#response-rate-table)
11. [Best Overall Response](#best-overall-response)
12. [Subgroup Analysis / Forest Plot Data](#subgroup-analysis--forest-plot-data)
13. [DLT Summary (Phase 1)](#dlt-summary-phase-1)
14. [PK Parameter Summary](#pk-parameter-summary)
15. [PK Concentration Summary](#pk-concentration-summary)
16. [PRO Summary](#pro-summary)
17. [KM Figure Shell](#km-figure-shell)
18. [Forest Plot Figure Shell](#forest-plot-figure-shell)
19. [Waterfall Plot Figure Shell](#waterfall-plot-figure-shell)
20. [Spider Plot Figure Shell](#spider-plot-figure-shell)
21. [Patient Listing Shell](#patient-listing-shell)
22. [AE Listing Shell](#ae-listing-shell)

---

## Shell Format Conventions

Every shell follows this structure:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Table/Figure/Listing {ID}                                           │
│ {Title}                                                             │
│ {Subtitle: Population, Study ID}                                    │
│ {Layout: Portrait/Landscape}                                        │
├─────────────────────────────────────────────────────────────────────┤
│ [Column headers and body content]                                   │
├─────────────────────────────────────────────────────────────────────┤
│ Footnotes                                                           │
│ Abbreviations                                                       │
│ Source/Program                                                      │
│ Programming Notes (internal -- not shown on final output)           │
└─────────────────────────────────────────────────────────────────────┘
```

**Placeholder conventions:**
- `[Study ID]` = replaced with actual study ID from metadata
- `(N=xxx)` = big-N denominator placeholder
- `xx`, `xxx` = count placeholder
- `xx.x` = one-decimal percentage
- `xx.xx` = two-decimal continuous value
- `xx.xxx` = three-decimal value (e.g., SD)
- `x.xxxx` = p-value
- `[Arm A]`, `[Arm B]` = replaced with actual arm names
- `{...}` = contextual replacement

**Adapt these templates to the study:**
- Replace `[Arm A]` / `[Arm B]` with actual treatment arm names from `study_design.treatment_arms`
- For single-arm studies, use one treatment column + Total
- For dose-finding studies, replace arm columns with dose level columns
- Add or remove row stubs based on what's actually collected in the study
- Adjust footnotes based on the specific statistical methods used

---

## Disposition

```
Table {ID}
Subject Disposition
{Population: All Enrolled Subjects} — Study [Study ID]
Layout: Portrait

                                        [Arm A]        [Arm B]        Total
                                        (N=xxx)        (N=xxx)        (N=xxx)
────────────────────────────────────────────────────────────────────────────────
Enrolled, n                               xxx            xxx            xxx
Randomized, n (%) [a]                   xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Completed study, n (%)                xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Discontinued study, n (%)             xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
    Adverse event                        xx (xx.x)      xx (xx.x)      xx (xx.x)
    Disease progression                  xx (xx.x)      xx (xx.x)      xx (xx.x)
    Withdrew consent                     xx (xx.x)      xx (xx.x)      xx (xx.x)
    Lost to follow-up                    xx (xx.x)      xx (xx.x)      xx (xx.x)
    Physician decision                   xx (xx.x)      xx (xx.x)      xx (xx.x)
    Death                                xx (xx.x)      xx (xx.x)      xx (xx.x)
    Protocol deviation                   xx (xx.x)      xx (xx.x)      xx (xx.x)
    Other                                xx (xx.x)      xx (xx.x)      xx (xx.x)
────────────────────────────────────────────────────────────────────────────────

[a] Percentages based on the number of enrolled subjects.
Abbreviations: N = number of subjects in the population; n = number of subjects
  in the specified category.
Source: ADSL
Program: t_disp.sas
```

**Programming notes:** Dataset: ADSL. Key variables: RANDFL, EOSSTT, DCSREAS. Percentages denominated on enrolled N. Adjust discontinuation reasons to match the CRF/protocol-defined categories.

---

## Demographics and Baseline

```
Table {ID}
Demographics and Baseline Characteristics
{Population: [Primary Analysis Population]} — Study [Study ID]
Layout: Portrait

                                        [Arm A]        [Arm B]        Total
                                        (N=xxx)        (N=xxx)        (N=xxx)
────────────────────────────────────────────────────────────────────────────────
Age (years)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x
  Min, Max                             xx, xx         xx, xx         xx, xx

Age group, n (%)
  <65 years                             xx (xx.x)      xx (xx.x)      xx (xx.x)
  >=65 years                            xx (xx.x)      xx (xx.x)      xx (xx.x)

Sex, n (%)
  Male                                  xx (xx.x)      xx (xx.x)      xx (xx.x)
  Female                                xx (xx.x)      xx (xx.x)      xx (xx.x)

Race, n (%)
  White                                 xx (xx.x)      xx (xx.x)      xx (xx.x)
  Black or African American             xx (xx.x)      xx (xx.x)      xx (xx.x)
  Asian                                 xx (xx.x)      xx (xx.x)      xx (xx.x)
  Other                                 xx (xx.x)      xx (xx.x)      xx (xx.x)

Ethnicity, n (%)
  Hispanic or Latino                    xx (xx.x)      xx (xx.x)      xx (xx.x)
  Not Hispanic or Latino                xx (xx.x)      xx (xx.x)      xx (xx.x)

ECOG Performance Status, n (%)
  0                                     xx (xx.x)      xx (xx.x)      xx (xx.x)
  1                                     xx (xx.x)      xx (xx.x)      xx (xx.x)

Weight (kg)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x
  Min, Max                             xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x

Height (cm)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xxx.x (xx.xx)  xxx.x (xx.xx)  xxx.x (xx.xx)

BMI (kg/m^2)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)

{Disease-specific baseline characteristics — adapt to indication}
────────────────────────────────────────────────────────────────────────────────

Abbreviations: BMI = body mass index; ECOG = Eastern Cooperative Oncology Group;
  Max = maximum; Min = minimum; N = number of subjects in the population;
  n = number of subjects in specified category; SD = standard deviation.
Note: Percentages are based on the number of subjects in each treatment group
  within the population.
Source: ADSL
Program: t_demo.sas
```

**Programming notes:** Dataset: ADSL. Continuous variables: n, mean, SD, median, min, max. Categorical variables: n (%). Add disease-specific rows from protocol (e.g., tumor stage, histology, smoking history, prior therapy lines for oncology; disease duration, prior medications for CNS).

---

## Drug Exposure

```
Table {ID}
Study Drug Exposure Summary
{Population: Safety Analysis Set} — Study [Study ID]
Layout: Portrait

                                        [Arm A]        [Arm B]        Total
                                        (N=xxx)        (N=xxx)        (N=xxx)
────────────────────────────────────────────────────────────────────────────────
Duration of treatment (weeks)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x
  Min, Max                             xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x

Number of doses/cycles
  n                                       xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x
  Min, Max                             xx, xx         xx, xx         xx, xx

Cumulative dose (mg)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xxxx (xxxx)    xxxx (xxxx)    xxxx (xxxx)
  Median                                 xxxx           xxxx           xxxx

Relative dose intensity (%)
  n                                       xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x

Dose modifications, n (%)
  Dose reduction                        xx (xx.x)      xx (xx.x)      xx (xx.x)
  Dose interruption                     xx (xx.x)      xx (xx.x)      xx (xx.x)
  Dose delay                            xx (xx.x)      xx (xx.x)      xx (xx.x)
────────────────────────────────────────────────────────────────────────────────

Abbreviations: Max = maximum; Min = minimum; N = number of subjects in the
  population; n = number of subjects in specified category; SD = standard deviation.
Source: ADEX
Program: t_expo.sas
```

---

## AE Overview Summary

```
Table {ID}
Overall Summary of Adverse Events
{Population: Safety Analysis Set} — Study [Study ID]
Layout: Portrait

                                              [Arm A]        [Arm B]        Total
                                              (N=xxx)        (N=xxx)        (N=xxx)
                                              n (%)          n (%)          n (%)
──────────────────────────────────────────────────────────────────────────────────────
Subjects with at least one:
  Treatment-emergent AE                     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Treatment-related AE [a]                  xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Grade >=3 AE                              xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Grade >=3 treatment-related AE             xx (xx.x)      xx (xx.x)      xx (xx.x)
  Serious AE                                xx (xx.x)      xx (xx.x)      xx (xx.x)
  Serious treatment-related AE               xx (xx.x)      xx (xx.x)      xx (xx.x)
  AE leading to discontinuation              xx (xx.x)      xx (xx.x)      xx (xx.x)
  AE leading to dose modification            xx (xx.x)      xx (xx.x)      xx (xx.x)
  AE leading to death                        xx (xx.x)      xx (xx.x)      xx (xx.x)
──────────────────────────────────────────────────────────────────────────────────────

[a] Treatment-related = assessed by investigator as related to study treatment.
Abbreviations: AE = adverse event; N = number of subjects in the population;
  n = number of subjects with at least one event.
Note: TEAEs are defined as AEs with onset on or after the first dose of study
  treatment through {reporting window} after the last dose.
  Subjects are counted once per row regardless of number of events.
Source: ADAE
Program: t_ae_summ.sas
```

---

## TEAE by SOC/PT/Grade

```
Table {ID}
Treatment-Emergent Adverse Events by System Organ Class, Preferred Term,
and Maximum CTCAE Grade
{Population: Safety Analysis Set} — Study [Study ID]
Layout: Landscape

                                              [Arm A] (N=xxx)                     [Arm B] (N=xxx)
                                    ──────────────────────────────     ──────────────────────────────
System Organ Class                  All Grades  Grade 3  Grade 4-5    All Grades  Grade 3  Grade 4-5
  Preferred Term                      n (%)      n (%)    n (%)         n (%)      n (%)    n (%)
────────────────────────────────────────────────────────────────────────────────────────────────────────
Any event                           xxx (xx.x)  xx (xx.x) xx (xx.x)  xxx (xx.x)  xx (xx.x) xx (xx.x)

{SOC 1}                              xx (xx.x)  xx (xx.x) xx (xx.x)   xx (xx.x)  xx (xx.x) xx (xx.x)
  {PT 1}                             xx (xx.x)  xx (xx.x) xx (xx.x)   xx (xx.x)  xx (xx.x) xx (xx.x)
  {PT 2}                             xx (xx.x)  xx (xx.x) xx (xx.x)   xx (xx.x)  xx (xx.x) xx (xx.x)

{SOC 2}                              xx (xx.x)  xx (xx.x) xx (xx.x)   xx (xx.x)  xx (xx.x) xx (xx.x)
  {PT 1}                             xx (xx.x)  xx (xx.x) xx (xx.x)   xx (xx.x)  xx (xx.x) xx (xx.x)
────────────────────────────────────────────────────────────────────────────────────────────────────────

Note: SOCs are sorted alphabetically; PTs are sorted by decreasing frequency
  within SOC based on {reference arm / total}.
  A subject is counted once per SOC and once per PT regardless of number of events.
  Adverse events are coded using MedDRA version xx.x and graded per NCI CTCAE v{x.x}.
Abbreviations: CTCAE = Common Terminology Criteria for Adverse Events;
  MedDRA = Medical Dictionary for Regulatory Activities; N = total number of subjects;
  NCI = National Cancer Institute; PT = preferred term; SOC = system organ class;
  TEAE = treatment-emergent adverse event.
Source: ADAE
Program: t_ae_soc_pt.sas
```

---

## Laboratory Shift Table

```
Table {ID}
Laboratory Shift Table: Baseline vs. Maximum Post-Baseline CTCAE Grade
{Population: Safety Analysis Set} — Study [Study ID]
Layout: Landscape

                                        Maximum Post-Baseline CTCAE Grade
                              ─────────────────────────────────────────────────
Laboratory Parameter          Baseline    Grade 0    Grade 1    Grade 2    Grade 3    Grade 4    Total
  [Arm A]                      Grade      n (%)      n (%)      n (%)      n (%)      n (%)
───────────────────────────────────────────────────────────────────────────────────────────────────────
{Parameter 1}
                               Grade 0    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Grade 1    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Grade 2    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Grade 3    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Total      xxx        xxx        xxx        xxx        xxx        xxx
───────────────────────────────────────────────────────────────────────────────────────────────────────

Note: Shift from baseline grade to worst post-baseline grade.
  Percentages based on subjects with both baseline and post-baseline assessments.
  Grading per NCI CTCAE v{x.x}.
Abbreviations: CTCAE = Common Terminology Criteria for Adverse Events;
  N = number of subjects; n = number of subjects in specified cell.
Source: ADLB
Program: t_lab_shift.sas
```

---

## Vital Signs by Visit

```
Table {ID}
Vital Signs: Summary Statistics by Visit
{Population: Safety Analysis Set} — Study [Study ID]
Layout: Landscape

                                        [Arm A] (N=xxx)                    [Arm B] (N=xxx)
                              ─────────────────────────────     ─────────────────────────────
Vital Sign Parameter / Visit    n    Mean (SD)     CFB (SD)       n    Mean (SD)     CFB (SD)
──────────────────────────────────────────────────────────────────────────────────────────────
Systolic Blood Pressure (mmHg)
  Baseline                     xxx  xxx.x (xx.xx)     —          xxx  xxx.x (xx.xx)     —
  Week 4                       xxx  xxx.x (xx.xx)  xx.x (xx.xx)  xxx  xxx.x (xx.xx)  xx.x (xx.xx)
  Week 8                       xxx  xxx.x (xx.xx)  xx.x (xx.xx)  xxx  xxx.x (xx.xx)  xx.x (xx.xx)
  ...

Diastolic Blood Pressure (mmHg)
  Baseline                     xxx  xxx.x (xx.xx)     —          xxx  xxx.x (xx.xx)     —
  ...
──────────────────────────────────────────────────────────────────────────────────────────────

Abbreviations: CFB = change from baseline; N = total number of subjects;
  n = number of subjects with non-missing data; SD = standard deviation.
Source: ADVS
Program: t_vs_visit.sas
```

---

## Time-to-Event KM Summary Table

```
Table {ID}
{Endpoint Name} Summary (Kaplan-Meier Analysis)
{Population: [Analysis Population]} — Study [Study ID]
Layout: Portrait

                                        [Arm A]              [Arm B]
                                        (N=xxx)              (N=xxx)
─────────────────────────────────────────────────────────────────────────────
Number of events, n (%)                xx (xx.x)            xx (xx.x)
Number censored, n (%)                 xx (xx.x)            xx (xx.x)

{Endpoint} (months) [a]
  Median                                 xx.x                 xx.x
  95% CI                             (xx.x, xx.x)         (xx.x, xx.x)
  Q1, Q3                              xx.x, xx.x           xx.x, xx.x

Hazard ratio [b]                              x.xxx
  95% CI                                  (x.xxx, x.xxx)
  p-value [c]                              x.xxxx

{Endpoint} rate at {timepoint 1} [d]
  Estimate (%)                            xx.x                 xx.x
  95% CI                             (xx.x, xx.x)         (xx.x, xx.x)

{Endpoint} rate at {timepoint 2}
  Estimate (%)                            xx.x                 xx.x
  95% CI                             (xx.x, xx.x)         (xx.x, xx.x)
─────────────────────────────────────────────────────────────────────────────

[a] Kaplan-Meier estimates. Median CI via {Brookmeyer-Crowley / log-log transformation}.
[b] Cox proportional hazards model, {stratified/unstratified},
    HR <1 favors [Arm A].
[c] {Unstratified/Stratified} log-rank test, two-sided.
[d] KM estimates with 95% CI via log-log transformation.
Abbreviations: CI = confidence interval; HR = hazard ratio; KM = Kaplan-Meier;
  N = number of subjects; n = number of subjects with events; Q1 = first quartile;
  Q3 = third quartile.
Source: ADTTE
Program: t_km_{endpoint}.sas
```

**Programming notes:** Dataset: ADTTE. Key variables: AVAL (time), CNSR (censor flag), PARAMCD. For single-arm studies, remove HR/p-value rows and show only KM estimates. For studies with multiple assessment methods (central vs. investigator), create separate tables.

---

## Response Rate Table

```
Table {ID}
Response Rate ({Assessment Method})
{Population: [Efficacy Population]} — Study [Study ID]
Layout: Portrait

                                        [Arm A]              [Arm B]
                                        (N=xxx)              (N=xxx)
─────────────────────────────────────────────────────────────────────────────
Responders (CR + PR), n (%)            xx (xx.x)            xx (xx.x)
  95% CI [a]                        (xx.x, xx.x)         (xx.x, xx.x)

  Complete Response (CR), n (%)        xx (xx.x)            xx (xx.x)
  Partial Response (PR), n (%)         xx (xx.x)            xx (xx.x)

Difference in response rate [b]              xx.x
  95% CI                                 (xx.x, xx.x)
  p-value [c]                              x.xxxx
─────────────────────────────────────────────────────────────────────────────

[a] {Exact two-sided 95% CI based on F-distribution / Wilson method / Clopper-Pearson}.
[b] [Arm A] - [Arm B]. {Method for CI of difference}.
[c] {CMH test / Chi-squared test / Fisher's exact test}, {stratified/unstratified}.
Abbreviations: CI = confidence interval; CR = complete response; N = number of
  subjects; n = number of subjects in specified category; PR = partial response.
Note: Response assessed per RECIST v{1.1} by {central imaging / investigator}.
Source: ADRS
Program: t_resp.sas
```

**Programming notes:** For single-arm studies, remove difference/p-value rows. CI method should match SAP specification. For oncology, always note the RECIST version and assessor type.

---

## Best Overall Response

```
Table {ID}
Best Overall Response ({Assessment Method})
{Population: [Efficacy Population]} — Study [Study ID]
Layout: Portrait

                                        [Arm A]              [Arm B]              Total
                                        (N=xxx)              (N=xxx)              (N=xxx)
──────────────────────────────────────────────────────────────────────────────────────────
Best Overall Response, n (%)
  Complete response (CR)               xx (xx.x)            xx (xx.x)            xx (xx.x)
  Partial response (PR)                xx (xx.x)            xx (xx.x)            xx (xx.x)
  Stable disease (SD)                  xx (xx.x)            xx (xx.x)            xx (xx.x)
  Progressive disease (PD)             xx (xx.x)            xx (xx.x)            xx (xx.x)
  Not evaluable (NE)                   xx (xx.x)            xx (xx.x)            xx (xx.x)

ORR (CR+PR), n (%)                     xx (xx.x)            xx (xx.x)            xx (xx.x)
  95% CI [a]                        (xx.x, xx.x)         (xx.x, xx.x)         (xx.x, xx.x)

DCR (CR+PR+SD), n (%)                  xx (xx.x)            xx (xx.x)            xx (xx.x)
  95% CI [a]                        (xx.x, xx.x)         (xx.x, xx.x)         (xx.x, xx.x)
──────────────────────────────────────────────────────────────────────────────────────────

[a] {Wilson / Clopper-Pearson / exact} 95% CI.
Abbreviations: CI = confidence interval; CR = complete response; DCR = disease control
  rate; NE = not evaluable; ORR = objective response rate; PD = progressive disease;
  PR = partial response; SD = stable disease.
Note: Assessed per RECIST v{1.1} by {central imaging / investigator}.
Source: ADRS
Program: t_bor.sas
```

---

## Subgroup Analysis / Forest Plot Data

```
Table {ID}
Subgroup Analysis of {Primary Endpoint}
{Population: [Primary Analysis Population]} — Study [Study ID]
Layout: Landscape

                                                              [Arm A]    [Arm B]
Subgroup                              n Events / N    n Events / N     HR (95% CI)
─────────────────────────────────────────────────────────────────────────────────────
All subjects                          xxx / xxx       xxx / xxx      x.xx (x.xx, x.xx)

Age
  <65 years                            xx / xxx        xx / xxx      x.xx (x.xx, x.xx)
  >=65 years                           xx / xxx        xx / xxx      x.xx (x.xx, x.xx)

Sex
  Male                                 xx / xxx        xx / xxx      x.xx (x.xx, x.xx)
  Female                               xx / xxx        xx / xxx      x.xx (x.xx, x.xx)

ECOG Performance Status
  0                                    xx / xxx        xx / xxx      x.xx (x.xx, x.xx)
  1                                    xx / xxx        xx / xxx      x.xx (x.xx, x.xx)

{Additional subgroups from metadata}
─────────────────────────────────────────────────────────────────────────────────────

Note: Hazard ratios from unstratified Cox proportional hazards model within
  each subgroup. HR <1 favors [Arm A].
Abbreviations: CI = confidence interval; ECOG = Eastern Cooperative Oncology Group;
  HR = hazard ratio; N = number of subjects in subgroup; n = number of events.
Source: ADTTE
Program: t_subgrp.sas
```

---

## DLT Summary (Phase 1)

```
Table {ID}
Summary of Dose-Limiting Toxicities by Dose Level
{Population: DLT-Evaluable Population} — Study [Study ID]
Layout: Portrait

                                  [DL0]      [DL-1]     [DL-2]     [DL-3]     Total
                                  (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)
────────────────────────────────────────────────────────────────────────────────────────
DLT-evaluable subjects, n          xxx         xxx        xxx        xxx        xxx

Subjects with DLT, n (%)          xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)

DLT by preferred term, n (%)
  {PT 1}                          xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  {PT 2}                          xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)

mTPI decision [a]                   {E/S/D}    {E/S/D}    {E/S/D}    {E/S/D}     —
────────────────────────────────────────────────────────────────────────────────────────

[a] E = Escalate; S = Stay; D = De-escalate; DU = Dose Unacceptable.
    Decision based on mTPI method with target DLT rate of {xx}%.
Abbreviations: DL = dose level; DLT = dose-limiting toxicity; mTPI = modified
  toxicity probability interval; N = number of subjects; n = number of subjects
  with event; PT = preferred term.
Note: DLTs defined per Protocol Section {x.x}. Observation period: first {x} cycles.
Source: ADAE
Program: t_dlt.sas
```

---

## PK Parameter Summary

```
Table {ID}
Summary of {Drug Name} Pharmacokinetic Parameters
{Population: PK Analysis Set} — Study [Study ID]
Layout: Landscape

                                  [DL0]                    [DL-1]                   Total
PK Parameter (unit)               (N=xxx)                  (N=xxx)                  (N=xxx)
───────────────────────────────────────────────────────────────────────────────────────────────
Cmax (ng/mL)
  n                                 xxx                      xxx                      xxx
  Mean (SD)                      xxxx (xxxx)              xxxx (xxxx)              xxxx (xxxx)
  %CV                              xx.x                     xx.x                     xx.x
  Median                            xxxx                     xxxx                     xxxx
  Min, Max                       xxxx, xxxx               xxxx, xxxx               xxxx, xxxx
  Geometric mean                    xxxx                     xxxx                     xxxx
  95% CI                        (xxxx, xxxx)             (xxxx, xxxx)             (xxxx, xxxx)

Tmax (h) [a]
  Median                            xx.x                     xx.x                     xx.x
  Min, Max                        xx.x, xx.x              xx.x, xx.x              xx.x, xx.x

AUCtau (ng*h/mL)
  n                                 xxx                      xxx                      xxx
  Mean (SD)                      xxxx (xxxx)              xxxx (xxxx)              xxxx (xxxx)
  Geometric mean                    xxxx                     xxxx                     xxxx
  95% CI                        (xxxx, xxxx)             (xxxx, xxxx)             (xxxx, xxxx)

CL/F (L/h)
  n                                 xxx                      xxx                      xxx
  Mean (SD)                      xx.xx (xx.xx)            xx.xx (xx.xx)            xx.xx (xx.xx)
  Geometric mean                    xx.xx                    xx.xx                    xx.xx
───────────────────────────────────────────────────────────────────────────────────────────────

[a] Tmax summarized with median (min, max) only.
Abbreviations: AUCtau = area under the concentration-time curve over one dosing
  interval; CL/F = apparent clearance; Cmax = maximum concentration; %CV = coefficient
  of variation; Max = maximum; Min = minimum; N = total subjects; n = subjects with
  parameter; PK = pharmacokinetics; SD = standard deviation; Tmax = time to Cmax.
Note: BLQ values set to zero. BLQ excluded from geometric mean calculations.
Source: ADPP
Program: t_pk_param.sas
```

---

## PK Concentration Summary

```
Table {ID}
Summary of {Drug Name} Plasma Concentrations by Visit and Dose Level
{Population: PK Analysis Set} — Study [Study ID]
Layout: Landscape

                                  [DL0] (N=xxx)            [DL-1] (N=xxx)
Visit / Timepoint                 n  Mean (SD)   Geo Mean    n  Mean (SD)   Geo Mean
────────────────────────────────────────────────────────────────────────────────────────
Cycle 1 Day 1 Pre-dose           xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx
Cycle 1 Day 1 0.5h               xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx
Cycle 1 Day 1 1h                 xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx
...
Cycle 2 Day 1 Pre-dose (trough)  xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx
────────────────────────────────────────────────────────────────────────────────────────

Abbreviations: Geo Mean = geometric mean; N = total subjects in dose level;
  n = subjects with concentration data at timepoint; SD = standard deviation.
Note: BLQ values set to zero for arithmetic calculations; excluded from geometric mean.
  Concentrations in ng/mL.
Source: ADPC
Program: t_pk_conc.sas
```

---

## PRO Summary

```
Table {ID}
{Instrument Name} Scores and Change from Baseline
{Population: PRO Analysis Set} — Study [Study ID]
Layout: Landscape

                                        [Arm A] (N=xxx)              [Arm B] (N=xxx)
                              ─────────────────────────────  ─────────────────────────────
Domain / Visit                  n    Score       CFB            n    Score       CFB
                                    Mean (SD)   Mean (SD)          Mean (SD)   Mean (SD)
──────────────────────────────────────────────────────────────────────────────────────────
{Domain 1, e.g., Global QoL}
  Baseline                     xxx  xx.x (xx.x)    —           xxx  xx.x (xx.x)    —
  Week 6                       xxx  xx.x (xx.x) xx.x (xx.x)   xxx  xx.x (xx.x) xx.x (xx.x)
  Week 12                      xxx  xx.x (xx.x) xx.x (xx.x)   xxx  xx.x (xx.x) xx.x (xx.x)

{Domain 2}
  Baseline                     xxx  xx.x (xx.x)    —           xxx  xx.x (xx.x)    —
  ...
──────────────────────────────────────────────────────────────────────────────────────────

Note: Scores transformed to 0-100 scale per {EORTC / EQ-5D / other} scoring manual.
  A change of {10} points is considered clinically meaningful.
Abbreviations: CFB = change from baseline; N = total subjects; n = subjects with
  non-missing data; PRO = patient-reported outcome; QoL = quality of life;
  SD = standard deviation.
Source: ADQS
Program: t_pro.sas
```

---

## KM Figure Shell

```
Figure {ID}
Kaplan-Meier Curve for {Endpoint Name}
{Population: [Analysis Population]} — Study [Study ID]

[Description]
X-axis: Time ({unit: months/weeks/days}) from {randomization / first dose}
Y-axis: {Endpoint} probability (0.0 to 1.0)
Curves: One line per treatment arm ({[Arm A] = solid blue, [Arm B] = dashed red})
Censor marks: Tick marks on each curve at censoring times
Legend: Treatment arm names with median and 95% CI
Below plot: Number at Risk table by treatment arm at regular intervals

Annotations:
  HR = x.xx (95% CI: x.xx, x.xx)
  {Stratified/Unstratified} log-rank p = x.xxxx
  Median [Arm A]: xx.x months (95% CI: xx.x, xx.x)
  Median [Arm B]: xx.x months (95% CI: xx.x, xx.x)

Source: ADTTE
Program: f_km_{endpoint}.sas
```

---

## Forest Plot Figure Shell

```
Figure {ID}
Forest Plot: Subgroup Analysis of {Primary Endpoint}
{Population: [Primary Analysis Population]} — Study [Study ID]

[Description]
Layout: Landscape
Left panel: Subgroup labels and n/N per arm
Center panel: Point estimate (diamond) with 95% CI (horizontal line) for each subgroup
  Vertical reference line at HR = 1.0
  Dashed vertical line at overall HR
Right panel: Numeric HR (95% CI) values
Bottom: "Favors [Arm A] <--- | ---> Favors [Arm B]" label

Subgroups displayed (from metadata subgroup_analyses):
  Overall
  Age (<65 / >=65)
  Sex (Male / Female)
  ECOG PS (0 / 1)
  {Additional subgroups}

Source: ADTTE
Program: f_forest.sas
```

---

## Waterfall Plot Figure Shell

```
Figure {ID}
Waterfall Plot: Best Percent Change in Sum of Target Lesion Diameters
{Population: [Efficacy Population]} — Study [Study ID]

[Description]
X-axis: Individual subjects (ordered by percent change, most shrinkage to most growth)
Y-axis: Best percent change from baseline (%)
Reference lines: -30% (PR threshold per RECIST), +20% (PD threshold per RECIST)
Bar color: {By treatment arm / by best overall response / by histology}

Note: Subjects with measurable disease at baseline and at least one post-baseline
  tumor assessment included. Investigator-assessed.

Source: ADTR
Program: f_waterfall.sas
```

---

## Spider Plot Figure Shell

```
Figure {ID}
Spider Plot: Percent Change in Sum of Target Lesion Diameters Over Time
{Population: [Efficacy Population]} — Study [Study ID]

[Description]
X-axis: Time from first dose ({weeks / cycles})
Y-axis: Percent change from baseline in sum of target lesion diameters (%)
Lines: One line per subject, connecting assessments over time
Reference lines: -30% (PR threshold), +20% (PD threshold)
Line color/style: {By best overall response / by treatment arm}

Note: Each line represents one subject's tumor burden trajectory.
  Assessments after documented PD or new anti-cancer therapy excluded.

Source: ADTR
Program: f_spider.sas
```

---

## Patient Listing Shell

```
Listing {ID}
{Listing Title}
{Population: [Relevant Population]} — Study [Study ID]
Layout: Landscape

Columns:
  Subject ID | {Site} | {Treatment/Dose Level} | {Parameter-specific columns} | {Comments}

Sort order: By {treatment arm / dose level}, then by subject ID

Source: {ADSL / ADAE / relevant dataset}
Program: l_{name}.sas
```

---

## AE Listing Shell

```
Listing {ID}
Listing of {AE Type: Serious AEs / AEs Leading to Death / DLTs / etc.}
{Population: Safety Analysis Set} — Study [Study ID]
Layout: Landscape

Columns:
  Subject ID | Treatment Arm | Age/Sex | AE Term (PT) | SOC |
  Start Date | End Date | Duration | CTCAE Grade | Serious (Y/N) |
  Relationship to Study Drug | Action Taken | Outcome

Sort order: By treatment arm, subject ID, AE start date

Source: ADAE
Program: l_ae_{type}.sas
```
