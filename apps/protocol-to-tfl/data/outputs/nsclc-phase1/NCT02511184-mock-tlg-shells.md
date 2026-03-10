# Mock TLG Shells — A8081054: Crizotinib + Pembrolizumab in ALK+ NSCLC

## Generation Metadata

- **Source:** outputs/nsclc-phase1/NCT02511184-trial-metadata.json
- **Generated:** 2026-03-06
- **Phase:** Phase 1b (dose-finding + dose expansion)
- **Design:** Open-label, single-arm, multicenter, sequential-cohort, mTPI dose de-escalation
- **Dose Levels:** 4 (DL0: Criz 250 mg BID + Pembro 200 mg Q3W; DL-1: Criz 250 mg BID lead-in + Pembro; DL-2: Criz 200 mg BID + Pembro; DL-3: Criz 250 mg QD + Pembro)
- **Populations:** SA (Safety Analysis Set), DLT-evaluable (PP), RE (Response Evaluable), PK, PRO
- **Total TLGs:** 55 (Tables: 36, Listings: 8, Figures: 11)

## TLG Index

### Tables (36)

| ID | Title | Population |
|----|-------|------------|
| T-14.1.1 | Subject Disposition | SA |
| T-14.1.2 | Demographics and Baseline Characteristics | SA |
| T-14.1.3 | Prior and Concomitant Medications Summary | SA |
| T-14.1.4 | Study Drug Exposure / Treatment Administration | SA |
| T-14.3.1.0 | DLT Summary by Dose Level | DLT-evaluable |
| T-14.3.1.1 | Overall Summary of Treatment-Emergent Adverse Events | SA |
| T-14.3.1.2 | TEAEs by MedDRA PT and Maximum CTCAE Grade | SA |
| T-14.3.1.3 | Treatment-Related AEs by MedDRA PT and Maximum CTCAE Grade | SA |
| T-14.3.1.4 | Serious Adverse Events | SA |
| T-14.3.1.5 | TEAEs Leading to Discontinuation or Dose Reduction | SA |
| T-14.3.1.6 | Deaths Summary | SA |
| T-14.3.1.7 | TEAEs by Grade Group (1-2, 3-4, 5) | SA |
| T-14.3.1.8 | AE Summary by Cycle Period | SA |
| T-14.3.2.1 | Laboratory Abnormalities by Worst CTCAE Grade | SA |
| T-14.3.2.2 | Laboratory Shift Table (Baseline vs. Worst Post-Baseline) | SA |
| T-14.3.2.3 | Laboratory Abnormalities by Cycle Period | SA |
| T-14.3.2.4 | Liver Function Summary / E-DISH Criteria | SA |
| T-14.3.3.1 | Vital Signs Descriptive Statistics by Visit | SA |
| T-14.3.3.2 | Vital Signs Categorical Analysis | SA |
| T-14.3.4.1 | ECG Parameters Summary | SA |
| T-14.3.4.2 | ECG Shift Table (Baseline vs. Worst QTcF/QTcB) | SA |
| T-14.3.5.1 | ECOG Performance Status Shift Table | SA |
| T-14.2.1 | Best Overall Response Summary | RE |
| T-14.2.2 | PFS Summary (Kaplan-Meier) | SA |
| T-14.2.3 | OS Summary (Kaplan-Meier) | SA |
| T-14.2.4 | Duration of Response Summary (Kaplan-Meier) | RE (responders) |
| T-14.2.5 | Time to Response Summary | RE (responders) |
| T-14.4.1 | Crizotinib Plasma Concentrations by Visit and Dose Level | PK |
| T-14.4.2 | PF-06260182 Plasma Concentrations by Visit and Dose Level | PK |
| T-14.4.3 | Pembrolizumab Serum Concentrations by Visit and Dose Level | PK |
| T-14.4.4 | Crizotinib and PF-06260182 PK Parameters (DL-1) | PK |
| T-14.4.5 | Effect of Pembrolizumab on Crizotinib PK (Mixed-Effect Model) | PK |
| T-14.4.6 | Crizotinib Steady-State Ctrough by Visit and Ethnicity | PK |
| T-14.5.1 | PRO Instrument Compliance Rates | PRO |
| T-14.5.2 | EORTC QLQ-C30 and QLQ-LC13 Scores and Change from Baseline | PRO |
| T-14.5.3 | PRO Responder Analysis (Improved/Stable/Deteriorated) | PRO |
| T-14.5.4 | VSAQ-ALK Frequency Analysis | PRO |

### Listings (8)

| ID | Title | Population |
|----|-------|------------|
| L-16.3.0 | DLT Listing by Dose Level | DLT-evaluable |
| L-16.3.1 | Death Listing | SA |
| L-16.3.4 | Patients with Grade >=3 Laboratory Toxicities | SA |
| L-16.2.1 | Individual Patient Efficacy Data (Dose Finding Phase) | SA/RE |
| L-16.3.5 | Other Laboratory Test Results | SA |
| L-16.1.1 | Protocol Deviations Listing | SA |
| L-16.1.2 | Prior and Follow-up Systemic Therapy Listing | SA |
| L-16.1.3 | Prior and Concomitant Drug/Non-Drug Treatment Listings | SA |

### Figures (11)

| ID | Title | Population |
|----|-------|------------|
| F-15.1.1 | Kaplan-Meier Plot of PFS | SA |
| F-15.1.2 | Kaplan-Meier Plot of OS | SA |
| F-15.1.3 | Kaplan-Meier Plot of Duration of Response | RE (responders) |
| F-15.3.1 | Crizotinib Mean/Median Concentration-Time Plots | PK |
| F-15.3.2 | Crizotinib Individual Concentration-Time Profiles | PK |
| F-15.3.3 | Pembrolizumab Mean/Median Concentration-Time Plots | PK |
| F-15.3.4 | Ctrough Plots by Visit (Crizotinib and PF-06260182) | PK |
| F-15.3.5 | Pembrolizumab Trough Concentration Plots | PK |
| F-15.3.6 | Box Plots for AUCtau and Cmax (Crizotinib, DL-1 Comparison) | PK |
| F-15.2.1 | E-DISH Scatter Plots (ALT/AST vs. Total Bilirubin) | SA |
| F-15.2.2 | AE Duration Kaplan-Meier Plots | SA |

---

## Table Shells

---

### T-14.1.1: Subject Disposition

```
Table T-14.1.1
Subject Disposition
Population: All Enrolled Subjects — Study A8081054
Layout: Landscape

                                        DL0            DL-1           DL-2           DL-3           Total
                                     Criz 250 BID   Criz 250 BID   Criz 200 BID   Criz 250 QD
                                     + Pembro       (lead-in)      + Pembro       + Pembro
                                                    + Pembro
                                     (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
───────────────────────────────────────────────────────────────────────────────────────────────────────────
Enrolled, n                            xxx            xxx            xxx            xxx            xxx
Treated, n (%) [a]                   xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  DLT-evaluable, n (%)              xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Not DLT-evaluable, n (%)           xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Study Phase
  Dose Finding Phase, n (%)          xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Dose Expansion Phase, n (%)        xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Completed study treatment, n (%)     xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
Discontinued study treatment, n (%)  xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Disease progression                xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Adverse event                      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Death                              xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Withdrew consent                   xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Physician decision                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Protocol deviation                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Other                              xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
───────────────────────────────────────────────────────────────────────────────────────────────────────────

[a] Percentages based on the number of enrolled subjects.
Abbreviations: BID = twice daily; Criz = crizotinib; DL = dose level; DLT = dose-limiting
  toxicity; N = number of subjects in the population; n = number of subjects in specified
  category; Pembro = pembrolizumab; QD = once daily; Q3W = every 3 weeks.
Source: ADSL
Program: t_disp.sas
```

**Programming notes:** Dataset: ADSL. Key variables: SAFFL, DLTFL, FASESSION (Dose Finding/Expansion), EOSSTT, DCSREAS, TRT01A (dose level). Percentages denominated on enrolled N per dose level.

---

### T-14.1.2: Demographics and Baseline Characteristics

```
Table T-14.1.2
Demographics and Baseline Characteristics
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                        DL0            DL-1           DL-2           DL-3           Total
                                        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
Age (years)
  n                                       xxx            xxx            xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x           xx.x           xx.x
  Min, Max                             xx, xx         xx, xx         xx, xx         xx, xx         xx, xx

Age group, n (%)
  <65 years                             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  >=65 years                            xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Sex, n (%)
  Male                                  xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Female                                xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Race, n (%)
  White                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Black or African American             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Asian                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Other                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Ethnicity, n (%)
  Hispanic or Latino                    xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Not Hispanic or Latino                xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

ECOG Performance Status, n (%)
  0                                     xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  1                                     xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Weight (kg)
  n                                       xxx            xxx            xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x           xx.x           xx.x
  Min, Max                             xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x

Height (cm)
  n                                       xxx            xxx            xxx            xxx            xxx
  Mean (SD)                            xxx.x (xx.xx)  xxx.x (xx.xx)  xxx.x (xx.xx)  xxx.x (xx.xx)  xxx.x (xx.xx)

Smoking status, n (%)
  Current smoker                        xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Former smoker                         xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Never smoked                          xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Histology, n (%)
  Adenocarcinoma                        xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Large cell                            xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Other non-squamous                    xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Disease stage at diagnosis, n (%)
  Stage IIIB                            xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Stage IV                              xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Recurrent                             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

ALK translocation status, n (%)
  Positive (confirmed)                  xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

PD-L1 expression, n (%)
  >=50%                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  1-49%                                 xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  <1%                                   xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Unknown                               xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

Brain metastases at baseline, n (%)
  Yes                                   xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  No                                    xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
─────────────────────────────────────────────────────────────────────────────────────────────────────────────

Abbreviations: ALK = anaplastic lymphoma kinase; BID = twice daily; ECOG = Eastern Cooperative
  Oncology Group; Max = maximum; Min = minimum; N = number of subjects in the population;
  n = number of subjects in specified category; PD-L1 = programmed death-ligand 1;
  SD = standard deviation.
Note: Percentages are based on the number of subjects in each dose level within the population.
Source: ADSL
Program: t_demo.sas
```

**Programming notes:** Dataset: ADSL. Continuous variables: n, mean, SD, median, min, max. Categorical: n (%). Disease-specific rows derived from NSCLC indication: smoking status, histology, disease stage, ALK status, PD-L1, brain metastases.

---

### T-14.1.3: Prior and Concomitant Medications Summary

```
Table T-14.1.3
Prior and Concomitant Medications Summary
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                                          Total
                                                          (N=xxx)
                                                          n (%)
──────────────────────────────────────────────────────────────────
Subjects with at least one prior medication             xxx (xx.x)
Subjects with at least one concomitant medication       xxx (xx.x)

Prior medications by ATC class [a]
  {ATC class 1}                                          xx (xx.x)
  {ATC class 2}                                          xx (xx.x)
  ...

Concomitant medications by ATC class [a]
  {ATC class 1}                                          xx (xx.x)
  {ATC class 2}                                          xx (xx.x)
  ...
──────────────────────────────────────────────────────────────────

[a] ATC = Anatomical Therapeutic Chemical classification (WHO Drug Dictionary).
Abbreviations: N = number of subjects in the population; n = number of subjects
  in specified category.
Note: Subjects are counted once per medication category.
Source: ADCM
Program: t_cm.sas
```

**Programming notes:** Dataset: ADCM. Prior medications: start date before first dose. Concomitant: ongoing or starting on/after first dose. Coded using WHO Drug Dictionary.

---

### T-14.1.4: Study Drug Exposure / Treatment Administration

```
Table T-14.1.4
Study Drug Exposure / Treatment Administration
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                        DL0            DL-1           DL-2           DL-3           Total
                                        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CRIZOTINIB

Duration of treatment (weeks)
  n                                       xxx            xxx            xxx            xxx            xxx
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x           xx.x           xx.x
  Min, Max                             xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x   xx.x, xxx.x

Number of cycles
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x           xx.x           xx.x
  Min, Max                             xx, xx         xx, xx         xx, xx         xx, xx         xx, xx

Relative dose intensity (%)
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x           xx.x           xx.x

Dose modifications, n (%)
  Dose reduction                        xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Dose interruption                     xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Dose delay                            xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

PEMBROLIZUMAB

Number of infusions
  Mean (SD)                            xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)   xx.x (xx.xx)
  Median                                 xx.x           xx.x           xx.x           xx.x           xx.x
  Min, Max                             xx, xx         xx, xx         xx, xx         xx, xx         xx, xx

Dose modifications, n (%)
  Dose delay/skip                       xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  Permanent discontinuation             xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
─────────────────────────────────────────────────────────────────────────────────────────────────────────────

Abbreviations: Max = maximum; Min = minimum; N = number of subjects in the population;
  n = number of subjects in specified category; SD = standard deviation.
Note: One cycle = 21 days. Crizotinib administered orally, continuously.
  Pembrolizumab administered IV Day 1 of each cycle (Q3W).
Source: ADEX
Program: t_expo.sas
```

---

### T-14.3.1.0: DLT Summary by Dose Level

```
Table T-14.3.1.0
Summary of Dose-Limiting Toxicities by Dose Level
Population: DLT-Evaluable Population — Study A8081054
Layout: Landscape

                                  DL0            DL-1           DL-2           DL-3           Total
                               Criz 250 BID   Criz 250 BID   Criz 200 BID   Criz 250 QD
                               + Pembro       (lead-in)      + Pembro       + Pembro
                                              + Pembro
                                  (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
────────────────────────────────────────────────────────────────────────────────────────────────────────
DLT-evaluable subjects, n          xxx            xxx            xxx            xxx            xxx

Subjects with DLT, n (%)         xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

DLT by preferred term, n (%)
  {PT 1}                         xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  {PT 2}                         xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  {PT 3}                         xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)

mTPI decision [a]                  {E/S/D/DU}     {E/S/D/DU}     {E/S/D/DU}     {E/S/D/DU}     ---
────────────────────────────────────────────────────────────────────────────────────────────────────────

[a] E = Escalate; S = Stay; D = De-escalate; DU = Dose Unacceptable (>=4 DLTs at dose level).
    Decision based on mTPI method with target DLT rate pT = 0.30.
    Underdosing interval: (0, 0.25); Proper-dosing interval: (0.25, 0.33);
    Overdosing interval: (0.33, 1.0).
Note: DLTs defined per Protocol Section 3.2. Observation period: first 2 cycles (6 weeks).
  Severity graded per NCI CTCAE v4.03.
  Patients not receiving >=80% of planned crizotinib or both pembrolizumab infusions
  in the DLT period (for reasons other than treatment-related AEs) are not DLT-evaluable.
Abbreviations: BID = twice daily; Criz = crizotinib; CTCAE = Common Terminology Criteria
  for Adverse Events; DL = dose level; DLT = dose-limiting toxicity; mTPI = modified
  toxicity probability interval; N = number of subjects; n = number of subjects with event;
  NCI = National Cancer Institute; Pembro = pembrolizumab; PT = preferred term;
  QD = once daily.
Source: ADAE
Program: t_dlt.sas
```

**Programming notes:** Dataset: ADAE (filtered for DLT events) + ADSL (DLTFL). DLT window = Cycles 1-2 (first 42 days). mTPI decision derived from observed DLT rate at each dose level using the Up-and-Down decision matrix.

---

### T-14.3.1.1: Overall Summary of Treatment-Emergent Adverse Events

```
Table T-14.3.1.1
Overall Summary of Treatment-Emergent Adverse Events
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                                   DL0        DL-1       DL-2       DL-3       Total
                                                   (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)
                                                   n (%)      n (%)      n (%)      n (%)      n (%)
───────────────────────────────────────────────────────────────────────────────────────────────────────
Subjects with at least one:
  Treatment-emergent AE                          xxx (xx.x) xxx (xx.x) xxx (xx.x) xxx (xx.x) xxx (xx.x)
  Treatment-related AE [a]                       xxx (xx.x) xxx (xx.x) xxx (xx.x) xxx (xx.x) xxx (xx.x)
  Grade >=3 AE                                    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Grade >=3 treatment-related AE                   xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Serious AE                                      xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Serious treatment-related AE                     xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  AE leading to permanent discontinuation          xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  AE leading to temporary discontinuation          xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  AE leading to dose reduction                     xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  AE leading to death                              xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
───────────────────────────────────────────────────────────────────────────────────────────────────────

[a] Treatment-related = assessed by investigator as related to crizotinib and/or
    pembrolizumab, or relatedness unknown.
Note: TEAEs defined as AEs with onset on or after first dose through 28 days after
  last crizotinib dose or 90 days after last pembrolizumab dose, whichever is later,
  and before initiation of new anti-cancer treatment.
  Subjects counted once per row regardless of number of events.
Abbreviations: AE = adverse event; N = number of subjects in the population;
  n = number of subjects with at least one event; TEAE = treatment-emergent adverse event.
Source: ADAE
Program: t_ae_summ.sas
```

---

### T-14.3.1.2: TEAEs by MedDRA PT and Maximum CTCAE Grade

```
Table T-14.3.1.2
Treatment-Emergent Adverse Events by MedDRA Preferred Term
and Maximum CTCAE Grade
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                           DL0 (N=xxx)                              Total (N=xxx)
                                 ────────────────────────────────       ────────────────────────────────
                                 All Grades  Grade 3   Grade 4-5       All Grades  Grade 3   Grade 4-5
Preferred Term [a]                 n (%)      n (%)     n (%)            n (%)      n (%)     n (%)
────────────────────────────────────────────────────────────────────────────────────────────────────────
Any event                        xxx (xx.x)  xx (xx.x)  xx (xx.x)     xxx (xx.x)  xx (xx.x)  xx (xx.x)

{PT 1}                            xx (xx.x)  xx (xx.x)  xx (xx.x)      xx (xx.x)  xx (xx.x)  xx (xx.x)
{PT 2}                            xx (xx.x)  xx (xx.x)  xx (xx.x)      xx (xx.x)  xx (xx.x)  xx (xx.x)
{PT 3}                            xx (xx.x)  xx (xx.x)  xx (xx.x)      xx (xx.x)  xx (xx.x)  xx (xx.x)
...
────────────────────────────────────────────────────────────────────────────────────────────────────────

[a] PTs sorted by decreasing frequency of all-grade events in the Total column.
    Clustered terms (SAP-defined) used where applicable.
Note: A subject is counted once per PT regardless of number of events.
  AEs coded using MedDRA version xx.x and graded per NCI CTCAE v4.03.
  Table repeated for each dose level; Total column shown across all dose levels.
Abbreviations: CTCAE = Common Terminology Criteria for Adverse Events;
  MedDRA = Medical Dictionary for Regulatory Activities; N = total subjects;
  NCI = National Cancer Institute; PT = preferred term; TEAE = treatment-emergent AE.
Source: ADAE
Program: t_ae_pt_grade.sas
```

**Programming notes:** Dataset: ADAE. Present by dose level (separate panels or columns) and Total. Use clustered terms per SAP. Sort PTs by decreasing frequency in Total. Show all grades, Grade 3, Grade 4-5 columns.

---

### T-14.3.1.3: Treatment-Related AEs by MedDRA PT and Maximum CTCAE Grade

```
Table T-14.3.1.3
Treatment-Related Adverse Events by MedDRA Preferred Term
and Maximum CTCAE Grade
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

[Structure identical to T-14.3.1.2, filtered for treatment-related AEs only]

Note: Treatment-related = assessed by investigator as related to crizotinib and/or
  pembrolizumab, or relatedness unknown.
Source: ADAE (where AEREL in ('RELATED','UNKNOWN'))
Program: t_ae_rel.sas
```

---

### T-14.3.1.4: Serious Adverse Events

```
Table T-14.3.1.4
Serious Adverse Events by MedDRA SOC and Preferred Term
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                           DL0        DL-1       DL-2       DL-3       Total
                                           (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)
System Organ Class                         n (%)      n (%)      n (%)      n (%)      n (%)
  Preferred Term
──────────────────────────────────────────────────────────────────────────────────────────────
Any SAE                                   xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)

{SOC 1}                                   xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  {PT 1}                                  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  {PT 2}                                  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
...
──────────────────────────────────────────────────────────────────────────────────────────────

Note: SOCs sorted alphabetically; PTs sorted by decreasing frequency within SOC.
  A subject is counted once per SOC and once per PT.
  All-causality and treatment-related SAEs shown.
Abbreviations: MedDRA = Medical Dictionary for Regulatory Activities; N = total subjects;
  n = number of subjects; PT = preferred term; SAE = serious adverse event;
  SOC = system organ class.
Source: ADAE (where AESER = 'Y')
Program: t_sae.sas
```

---

### T-14.3.1.5: TEAEs Leading to Discontinuation or Dose Reduction

```
Table T-14.3.1.5
TEAEs Leading to Permanent/Temporary Discontinuation or Dose Reduction
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                           DL0        DL-1       DL-2       DL-3       Total
                                           (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)
Action / Preferred Term                    n (%)      n (%)      n (%)      n (%)      n (%)
──────────────────────────────────────────────────────────────────────────────────────────────
AEs leading to permanent discontinuation
  Any                                     xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  {PT 1}                                  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  ...

AEs leading to temporary discontinuation
  Any                                     xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  {PT 1}                                  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  ...

AEs leading to dose reduction
  Any                                     xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  {PT 1}                                  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  ...
──────────────────────────────────────────────────────────────────────────────────────────────

Note: A subject may appear in multiple action categories.
  PTs sorted by decreasing frequency within each action category.
Abbreviations: AE = adverse event; N = total subjects; n = number of subjects;
  PT = preferred term; TEAE = treatment-emergent adverse event.
Source: ADAE
Program: t_ae_disc.sas
```

---

### T-14.3.1.6: Deaths Summary

```
Table T-14.3.1.6
Deaths Summary
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                                   DL0        DL-1       DL-2       DL-3       Total
                                                   (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)    (N=xxx)
                                                   n (%)      n (%)      n (%)      n (%)      n (%)
───────────────────────────────────────────────────────────────────────────────────────────────────────
All deaths                                        xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)

On-treatment deaths [a]                           xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Disease progression                             xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Adverse event                                   xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Other                                           xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)

Post-treatment deaths [b]                         xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Disease progression                             xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
  Other                                           xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)
───────────────────────────────────────────────────────────────────────────────────────────────────────

[a] On-treatment: within 28 days of last crizotinib dose and/or within 90 days of
    last pembrolizumab dose.
[b] Post-treatment: beyond the on-treatment window.
Abbreviations: N = total subjects; n = number of subjects.
Source: ADSL, ADAE
Program: t_death.sas
```

---

### T-14.3.1.7: TEAEs by Grade Group (1-2, 3-4, 5)

```
Table T-14.3.1.7
Treatment-Emergent Adverse Events by Preferred Term and CTCAE Grade Group
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                       Total (N=xxx)
                              ─────────────────────────────────
Preferred Term [a]            Grade 1-2      Grade 3-4      Grade 5
                                n (%)          n (%)          n (%)
──────────────────────────────────────────────────────────────────────
Any event                    xxx (xx.x)      xx (xx.x)      xx (xx.x)

{PT 1}                        xx (xx.x)      xx (xx.x)      xx (xx.x)
{PT 2}                        xx (xx.x)      xx (xx.x)      xx (xx.x)
...
──────────────────────────────────────────────────────────────────────

[a] Sorted by decreasing total frequency. May also be presented by dose level.
Abbreviations: CTCAE = Common Terminology Criteria for Adverse Events;
  N = total subjects; n = number of subjects; PT = preferred term.
Source: ADAE
Program: t_ae_grpgrade.sas
```

---

### T-14.3.1.8: AE Summary by Cycle Period

```
Table T-14.3.1.8
Treatment-Emergent AE Summary by Cycle Period
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                    Lead-in [a]    Cycle 1        Cycle 2        Cycles >=3     Total
                                    (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)        (N=xxx)
                                    n (%)          n (%)          n (%)          n (%)          n (%)
─────────────────────────────────────────────────────────────────────────────────────────────────────────
Subjects with any TEAE            xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)     xxx (xx.x)
  Grade >=3 TEAE                   xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  SAE                              xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
  TEAE leading to D/C              xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)      xx (xx.x)
─────────────────────────────────────────────────────────────────────────────────────────────────────────

[a] Lead-in period applies to DL-1 only (Cycle -1: 21-day crizotinib monotherapy).
Note: AEs assigned to the cycle in which they first occurred.
  N per cycle = number of subjects who entered that cycle period.
Abbreviations: D/C = discontinuation; N = number of subjects entering cycle;
  n = number of subjects; SAE = serious adverse event; TEAE = treatment-emergent AE.
Source: ADAE
Program: t_ae_cycle.sas
```

---

### T-14.3.2.1: Laboratory Abnormalities by Worst CTCAE Grade

```
Table T-14.3.2.1
Laboratory Abnormalities by Worst CTCAE Grade
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                           DL0 (N=xxx)                              Total (N=xxx)
                                 ────────────────────────────────       ────────────────────────────────
                                 Grade 1    Grade 2   Grade 3   Grade 4  Grade 1   Grade 2  Grade 3  Grade 4
Laboratory Parameter               n (%)    n (%)     n (%)     n (%)     n (%)     n (%)    n (%)    n (%)
────────────────────────────────────────────────────────────────────────────────────────────────────────────
Hematology
  Neutrophils decreased           xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Leukocytes decreased            xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Hemoglobin decreased            xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Platelets decreased             xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Lymphocytes decreased           xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)

Chemistry
  ALT increased                   xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  AST increased                   xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Alkaline phosphatase increased  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Total bilirubin increased       xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Creatinine increased            xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Hyponatremia                    xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Hyperglycemia                   xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Hypokalemia                     xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
  Hypophosphatemia                xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)  xx(xx.x) xx(xx.x) xx(xx.x) xx(xx.x)
────────────────────────────────────────────────────────────────────────────────────────────────────────────

Note: Worst post-baseline grade per patient. Graded per NCI CTCAE v4.03.
  May also be presented by cycle period (Cycle 1, Cycle 2, Cycles >=3).
  Percentages based on subjects with baseline and post-baseline values.
Abbreviations: ALT = alanine aminotransferase; AST = aspartate aminotransferase;
  CTCAE = Common Terminology Criteria for Adverse Events; N = total subjects;
  n = number of subjects; NCI = National Cancer Institute.
Source: ADLB
Program: t_lab_grade.sas
```

---

### T-14.3.2.2: Laboratory Shift Table

```
Table T-14.3.2.2
Laboratory Shift Table: Baseline vs. Maximum Post-Baseline CTCAE Grade
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                        Maximum Post-Baseline CTCAE Grade
                              ─────────────────────────────────────────────────
Laboratory Parameter          Baseline    Grade 0    Grade 1    Grade 2    Grade 3    Grade 4    Total
                               Grade      n (%)      n (%)      n (%)      n (%)      n (%)
───────────────────────────────────────────────────────────────────────────────────────────────────────
ALT increased
                               Grade 0    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Grade 1    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Grade 2    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               Total      xxx        xxx        xxx        xxx        xxx        xxx

AST increased
                               Grade 0    xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xx (xx.x)  xxx
                               ...

{Additional parameters}
───────────────────────────────────────────────────────────────────────────────────────────────────────

Note: Shift from baseline grade to worst post-baseline grade.
  Percentages based on subjects with both baseline and post-baseline assessments.
  Grading per NCI CTCAE v4.03.
Abbreviations: ALT = alanine aminotransferase; AST = aspartate aminotransferase;
  CTCAE = Common Terminology Criteria for Adverse Events;
  N = number of subjects; n = number of subjects in specified cell.
Source: ADLB
Program: t_lab_shift.sas
```

---

### T-14.3.2.3: Laboratory Abnormalities by Cycle Period

```
Table T-14.3.2.3
Laboratory Abnormalities by Cycle Period
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

[Structure identical to T-14.3.2.1, with columns for Cycle 1, Cycle 2, Cycles >=3
 instead of dose levels]

Note: Worst grade within each cycle period. For DL-1, lead-in period (Cycle -1) shown separately.
Source: ADLB
Program: t_lab_cycle.sas
```

---

### T-14.3.2.4: Liver Function Summary / E-DISH Criteria

```
Table T-14.3.2.4
Liver Function Summary — E-DISH Criteria
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                                          Total
                                                          (N=xxx)
                                                          n (%)
──────────────────────────────────────────────────────────────────
ALT >3x ULN                                             xx (xx.x)
ALT >5x ULN                                             xx (xx.x)
ALT >10x ULN                                            xx (xx.x)
ALT >20x ULN                                            xx (xx.x)

AST >3x ULN                                             xx (xx.x)
AST >5x ULN                                             xx (xx.x)

Total bilirubin >2x ULN                                 xx (xx.x)

ALT >3x ULN and total bilirubin >2x ULN [a]             xx (xx.x)
AST >3x ULN and total bilirubin >2x ULN [a]             xx (xx.x)
──────────────────────────────────────────────────────────────────

[a] Potential Hy's Law cases. See E-DISH scatter plots (F-15.2.1).
Abbreviations: ALT = alanine aminotransferase; AST = aspartate aminotransferase;
  E-DISH = evaluation of drug-induced serious hepatotoxicity; N = total subjects;
  n = number of subjects; ULN = upper limit of normal.
Source: ADLB
Program: t_liver.sas
```

---

### T-14.3.3.1: Vital Signs Descriptive Statistics by Visit

```
Table T-14.3.3.1
Vital Signs: Summary Statistics by Visit
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                            Total (N=xxx)
                              ──────────────────────────────────────────
Vital Sign Parameter / Visit    n    Actual Value        CFB
                                     Mean (SD)           Mean (SD)
──────────────────────────────────────────────────────────────────────────
Systolic Blood Pressure (mmHg)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  Cycle 1 Day 1                xxx  xxx.x (xx.xx)       xx.x (xx.xx)
  Cycle 2 Day 1                xxx  xxx.x (xx.xx)       xx.x (xx.xx)
  Cycle 3 Day 1                xxx  xxx.x (xx.xx)       xx.x (xx.xx)
  ...

Diastolic Blood Pressure (mmHg)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  ...

Pulse Rate (bpm)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  ...

Body Weight (kg)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  ...
──────────────────────────────────────────────────────────────────────────

Abbreviations: bpm = beats per minute; CFB = change from baseline; N = total subjects;
  n = number of subjects with non-missing data; SD = standard deviation.
Note: May also be presented by dose level.
Source: ADVS
Program: t_vs_visit.sas
```

---

### T-14.3.3.2: Vital Signs Categorical Analysis

```
Table T-14.3.3.2
Vital Signs Categorical Analysis
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                                          Total
                                                          (N=xxx)
                                                          n (%)
──────────────────────────────────────────────────────────────────
Systolic Blood Pressure
  Maximum increase from baseline >=40 mmHg               xx (xx.x)

Diastolic Blood Pressure
  Maximum increase from baseline >=20 mmHg               xx (xx.x)

Body Weight
  Maximum change from baseline >=10%                     xx (xx.x)

Pulse Rate
  Post-baseline <50 bpm                                  xx (xx.x)
  Post-baseline >120 bpm                                 xx (xx.x)
  Maximum increase from baseline >=30 bpm                xx (xx.x)
  Maximum decrease from baseline >=30 bpm                xx (xx.x)
──────────────────────────────────────────────────────────────────

Note: Thresholds defined per SAP Section 8.3.3.5.
Abbreviations: bpm = beats per minute; N = total subjects; n = number of subjects.
Source: ADVS
Program: t_vs_cat.sas
```

---

### T-14.3.4.1: ECG Parameters Summary

```
Table T-14.3.4.1
ECG Parameters Summary by Visit
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                            Total (N=xxx)
                              ──────────────────────────────────────────
ECG Parameter / Visit           n    Actual Value        CFB
                                     Mean (SD)           Mean (SD)
──────────────────────────────────────────────────────────────────────────
Heart Rate (bpm)
  Baseline                     xxx  xx.x (xx.xx)            ---
  Cycle 1 Day 1                xxx  xx.x (xx.xx)        xx.x (xx.xx)
  ...

QTcF (ms)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  Cycle 1 Day 1                xxx  xxx.x (xx.xx)       xx.x (xx.xx)
  ...

QTcB (ms)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  ...

PR Interval (ms)
  Baseline                     xxx  xxx.x (xx.xx)           ---
  ...

QRS Duration (ms)
  Baseline                     xxx  xx.x (xx.xx)            ---
  ...
──────────────────────────────────────────────────────────────────────────

ECG Categorical Analysis                                   n (%)
──────────────────────────────────────────────────────────────────
QTcF Maximum Post-Baseline Value
  <450 ms                                                xx (xx.x)
  450 to <480 ms                                         xx (xx.x)
  480 to <500 ms                                         xx (xx.x)
  >=500 ms                                               xx (xx.x)

QTcF Maximum Increase from Baseline
  <30 ms                                                 xx (xx.x)
  30 to <60 ms                                           xx (xx.x)
  >=60 ms                                                xx (xx.x)

[Same categories repeated for QTcB]
──────────────────────────────────────────────────────────────────

Abbreviations: bpm = beats per minute; CFB = change from baseline;
  ECG = electrocardiogram; ms = milliseconds; N = total subjects;
  n = number of subjects; QTcB = QT corrected by Bazett;
  QTcF = QT corrected by Fridericia; SD = standard deviation.
Note: May also be presented by dose level.
Source: ADEG
Program: t_ecg.sas
```

---

### T-14.3.4.2: ECG Shift Table

```
Table T-14.3.4.2
ECG Shift Table: Baseline vs. Worst On-Study QTcF Category
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                                        Maximum Post-Baseline QTcF Category
                              ─────────────────────────────────────────────────
                              Baseline      <450 ms    450-<480 ms  480-<500 ms  >=500 ms   Total
───────────────────────────────────────────────────────────────────────────────────────────────────
                               <450 ms     xx (xx.x)   xx (xx.x)    xx (xx.x)   xx (xx.x)    xxx
                               450-<480    xx (xx.x)   xx (xx.x)    xx (xx.x)   xx (xx.x)    xxx
                               480-<500    xx (xx.x)   xx (xx.x)    xx (xx.x)   xx (xx.x)    xxx
                               >=500       xx (xx.x)   xx (xx.x)    xx (xx.x)   xx (xx.x)    xxx
                               Total       xxx         xxx          xxx         xxx          xxx
───────────────────────────────────────────────────────────────────────────────────────────────────

[Same structure repeated for QTcB]

Note: Percentages based on subjects with baseline and post-baseline ECG.
Abbreviations: ms = milliseconds; QTcB = QT corrected by Bazett;
  QTcF = QT corrected by Fridericia.
Source: ADEG
Program: t_ecg_shift.sas
```

---

### T-14.3.5.1: ECOG Performance Status Shift Table

```
Table T-14.3.5.1
ECOG Performance Status Shift Table: Baseline vs. Worst On-Study
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                        Worst Post-Baseline ECOG PS
                              ─────────────────────────────────────────────
                              Baseline      0          1          2        >=3        Total
──────────────────────────────────────────────────────────────────────────────────────────
                                 0        xx (xx.x)  xx (xx.x)  xx (xx.x) xx (xx.x)   xxx
                                 1        xx (xx.x)  xx (xx.x)  xx (xx.x) xx (xx.x)   xxx
                               Total      xxx        xxx        xxx       xxx         xxx
──────────────────────────────────────────────────────────────────────────────────────────

Note: Percentages based on subjects with baseline and post-baseline ECOG assessments.
Abbreviations: ECOG = Eastern Cooperative Oncology Group; PS = performance status.
Source: ADSL, ADQS
Program: t_ecog_shift.sas
```

---

### T-14.2.1: Best Overall Response Summary

```
Table T-14.2.1
Best Overall Response Summary
Population: Response Evaluable Analysis Set — Study A8081054
Layout: Portrait

                                               Total
                                               (N=xxx)
───────────────────────────────────────────────────────────────
Best Overall Response [a], n (%)
  Complete response (CR)                       xx (xx.x)
  Partial response (PR)                        xx (xx.x)
  Stable disease (SD)                          xx (xx.x)
  Progressive disease (PD)                     xx (xx.x)
  Early death                                  xx (xx.x)
  Indeterminate (IND)                          xx (xx.x)

ORR (CR + PR), n (%)                           xx (xx.x)
  95% CI [b]                               (xx.x, xx.x)

DCR (CR + PR + SD), n (%)                      xx (xx.x)
  95% CI [b]                               (xx.x, xx.x)
───────────────────────────────────────────────────────────────

[a] Confirmed responses per RECIST v1.1. A confirmed response requires repeat
    imaging at least 4 weeks after initial documentation of response.
[b] Exact 2-sided 95% CI based on the F-distribution.
Note: Response assessed by investigator per RECIST v1.1.
  May also be presented by dose level.
Abbreviations: CI = confidence interval; CR = complete response; DCR = disease
  control rate; IND = indeterminate; ORR = objective response rate;
  PD = progressive disease; PR = partial response; SD = stable disease.
Source: ADRS
Program: t_bor.sas
```

**Programming notes:** Dataset: ADRS. Key variables: PARAMCD=BOR, AVALC. CI method = exact (F-distribution), per SAP. Single-arm study; no comparative statistics.

---

### T-14.2.2: PFS Summary (Kaplan-Meier)

```
Table T-14.2.2
Progression-Free Survival Summary (Kaplan-Meier Analysis)
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                                          Total
                                                          (N=xxx)
───────────────────────────────────────────────────────────────────
Number of events, n (%)                                  xx (xx.x)
  Progression                                            xx (xx.x)
  Death                                                  xx (xx.x)
Number censored, n (%)                                   xx (xx.x)

PFS (months) [a]
  Median                                                   xx.x
  95% CI                                              (xx.x, xx.x)
  Q1, Q3                                              xx.x, xx.x

6-month PFS rate [b]
  Estimate (%)                                             xx.x
  95% CI                                              (xx.x, xx.x)

12-month PFS rate [b]
  Estimate (%)                                             xx.x
  95% CI                                              (xx.x, xx.x)

18-month PFS rate [b]
  Estimate (%)                                             xx.x
  95% CI                                              (xx.x, xx.x)
───────────────────────────────────────────────────────────────────

[a] Kaplan-Meier estimates. PFS (months) = (first event date - first dose date + 1) / 30.44.
[b] Product limit estimates with 95% CI calculated via normal approximation
    on log(-log(PFS)) then back-transformed.
Note: Progression assessed by investigator per RECIST v1.1.
  Single-arm study; no comparative statistics.
Abbreviations: CI = confidence interval; KM = Kaplan-Meier; N = total subjects;
  n = number of subjects; PFS = progression-free survival; Q1 = first quartile;
  Q3 = third quartile.
Source: ADTTE (PARAMCD = PFS)
Program: t_km_pfs.sas
```

---

### T-14.2.3: OS Summary (Kaplan-Meier)

```
Table T-14.2.3
Overall Survival Summary (Kaplan-Meier Analysis)
Population: Safety Analysis Set — Study A8081054
Layout: Portrait

                                                          Total
                                                          (N=xxx)
───────────────────────────────────────────────────────────────────
Number of events (deaths), n (%)                         xx (xx.x)
Number censored, n (%)                                   xx (xx.x)

OS (months) [a]
  Median                                                   xx.x
  95% CI                                              (xx.x, xx.x)
  Q1, Q3                                              xx.x, xx.x

12-month OS rate [b]
  Estimate (%)                                             xx.x
  95% CI                                              (xx.x, xx.x)

18-month OS rate [b]
  Estimate (%)                                             xx.x
  95% CI                                              (xx.x, xx.x)
───────────────────────────────────────────────────────────────────

[a] Kaplan-Meier estimates. OS (months) = (date of death - first dose date + 1) / 30.44.
    Censored on last date known alive for subjects still alive.
[b] Product limit estimates with 95% CI calculated via normal approximation
    on log(-log(OS)) then back-transformed.
Abbreviations: CI = confidence interval; N = total subjects; n = number of subjects;
  OS = overall survival; Q1 = first quartile; Q3 = third quartile.
Source: ADTTE (PARAMCD = OS)
Program: t_km_os.sas
```

---

### T-14.2.4: Duration of Response Summary (Kaplan-Meier)

```
Table T-14.2.4
Duration of Response Summary (Kaplan-Meier Analysis)
Population: Responders from Response Evaluable Analysis Set — Study A8081054
Layout: Portrait

                                                          Responders
                                                          (N=xxx)
───────────────────────────────────────────────────────────────────
Number of events, n (%)                                  xx (xx.x)
  Progression                                            xx (xx.x)
  Death                                                  xx (xx.x)
Number censored, n (%)                                   xx (xx.x)

DR (weeks) [a]
  Median                                                   xx.x
  95% CI                                              (xx.x, xx.x)
  Q1, Q3                                              xx.x, xx.x
───────────────────────────────────────────────────────────────────

[a] KM estimates. DR (weeks) = (progression/death date - first date of OR + 1) / 7.02.
    Censoring rules identical to PFS.
Note: Population restricted to subjects with confirmed CR or PR.
  Time origin = date of first confirmed objective response.
Abbreviations: CI = confidence interval; CR = complete response; DR = duration of
  response; KM = Kaplan-Meier; N = number of responders; n = number of subjects;
  OR = objective response; PR = partial response; Q1 = first quartile;
  Q3 = third quartile.
Source: ADTTE (PARAMCD = DR)
Program: t_km_dr.sas
```

---

### T-14.2.5: Time to Response Summary

```
Table T-14.2.5
Time to Response Summary
Population: Responders from Response Evaluable Analysis Set — Study A8081054
Layout: Portrait

                                                          Responders
                                                          (N=xxx)
───────────────────────────────────────────────────────────────────
TTR (weeks) [a]
  n                                                         xxx
  Median                                                   xx.x
  Min, Max                                             xx.x, xx.x
───────────────────────────────────────────────────────────────────

[a] TTR (weeks) = (first date of OR - date of first dose + 1) / 7.02.
Note: Population restricted to subjects with confirmed CR or PR.
  Descriptive statistics only (not a time-to-event analysis).
Abbreviations: Max = maximum; Min = minimum; N = number of responders;
  n = number of subjects; OR = objective response; TTR = time to response.
Source: ADTTE
Program: t_ttr.sas
```

---

### T-14.4.1: Crizotinib Plasma Concentrations by Visit and Dose Level

```
Table T-14.4.1
Summary of Crizotinib Plasma Concentrations by Visit and Dose Level
Population: PK Concentration Analysis Set — Study A8081054
Layout: Landscape

                                  DL0 (N=xxx)              DL-1 (N=xxx)             Total (N=xxx)
Visit / Timepoint                 n  Mean (SD)   Geo Mean   n  Mean (SD)   Geo Mean   n  Mean (SD)  Geo Mean
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
Cycle -1 Day 15 [a]
  Pre-dose (Ctrough)              --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  0.5h post-dose                  --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  1h post-dose                    --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  2h post-dose                    --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  4h post-dose                    --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  6h post-dose                    --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  8h post-dose                    --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 1 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 2 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 4 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 6 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  0.5h post-dose [b]              --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  ...8h post-dose [b]             --    --          --      xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 8 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
─────────────────────────────────────────────────────────────────────────────────────────────────────────────

[a] Cycle -1 applicable to DL-1 only (crizotinib monotherapy lead-in).
[b] Full PK profile at Cycle 6 Day 1 for DL-1 only (combination with pembrolizumab).
Note: Concentrations in ng/mL. BLQ values set to zero for arithmetic calculations;
  excluded from geometric mean calculations.
Abbreviations: BLQ = below limit of quantification; Geo Mean = geometric mean;
  N = total subjects in dose level; n = subjects with concentration data;
  PK = pharmacokinetics; SD = standard deviation.
Source: ADPC
Program: t_pk_conc_criz.sas
```

---

### T-14.4.2: PF-06260182 Plasma Concentrations by Visit and Dose Level

```
Table T-14.4.2
Summary of PF-06260182 (Crizotinib Metabolite) Plasma Concentrations
by Visit and Dose Level
Population: PK Concentration Analysis Set — Study A8081054
Layout: Landscape

[Structure identical to T-14.4.1 for metabolite PF-06260182]

Source: ADPC
Program: t_pk_conc_met.sas
```

---

### T-14.4.3: Pembrolizumab Serum Concentrations by Visit and Dose Level

```
Table T-14.4.3
Summary of Pembrolizumab Serum Concentrations by Visit and Dose Level
Population: PK Concentration Analysis Set — Study A8081054
Layout: Landscape

                                  DL0 (N=xxx)              DL-1 (N=xxx)             Total (N=xxx)
Visit / Timepoint                 n  Mean (SD)   Geo Mean   n  Mean (SD)   Geo Mean   n  Mean (SD)  Geo Mean
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
Cycle 1 Day 1
  Pre-dose                       xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  End of infusion                xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 1 Day 4-8
  Pre-dose (trough)              xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 1 Day 15
  Pre-dose (trough)              xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 2 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
  End of infusion                xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 4 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 6 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Cycle 8 Day 1
  Pre-dose (Ctrough)             xx  xxxx (xxxx)   xxxx    xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
─────────────────────────────────────────────────────────────────────────────────────────────────────────────

Note: Concentrations in ug/mL. BLQ values set to zero for arithmetic calculations;
  excluded from geometric mean calculations.
Abbreviations: Geo Mean = geometric mean; N = total subjects; n = subjects with data;
  PK = pharmacokinetics; SD = standard deviation.
Source: ADPC
Program: t_pk_conc_pembro.sas
```

---

### T-14.4.4: Crizotinib and PF-06260182 PK Parameters (DL-1)

```
Table T-14.4.4
Summary of Crizotinib and PF-06260182 Pharmacokinetic Parameters
Population: PK Parameter Analysis Set (DL-1) — Study A8081054
Layout: Landscape

                                  Crizotinib Alone           Crizotinib + Pembrolizumab
                                  (Cycle -1 Day 15)          (Cycle 6 Day 1)
PK Parameter (unit)               (N=xxx)                    (N=xxx)
────────────────────────────────────────────────────────────────────────────────────────
CRIZOTINIB

Cmax (ng/mL)
  n                                 xxx                        xxx
  Mean (SD)                      xxxx (xxxx)                xxxx (xxxx)
  %CV                              xx.x                       xx.x
  Median                            xxxx                       xxxx
  Min, Max                       xxxx, xxxx                 xxxx, xxxx
  Geometric mean                    xxxx                       xxxx
  95% CI                        (xxxx, xxxx)               (xxxx, xxxx)

Tmax (h)
  Median                            xx.x                       xx.x
  Min, Max                        xx.x, xx.x                xx.x, xx.x

Ctrough (ng/mL)
  n                                 xxx                        xxx
  Mean (SD)                      xxxx (xxxx)                xxxx (xxxx)
  Geometric mean                    xxxx                       xxxx

AUC0-8 (ng*h/mL)
  n                                 xxx                        xxx
  Mean (SD)                      xxxx (xxxx)                xxxx (xxxx)
  Geometric mean                    xxxx                       xxxx

AUCtau (ng*h/mL)
  n                                 xxx                        xxx
  Mean (SD)                      xxxx (xxxx)                xxxx (xxxx)
  Geometric mean                    xxxx                       xxxx

CL/F (L/h)
  n                                 xxx                        xxx
  Mean (SD)                      xx.xx (xx.xx)              xx.xx (xx.xx)
  Geometric mean                    xx.xx                      xx.xx

PF-06260182 (METABOLITE)

Cmax (ng/mL)
  [Same statistics as above]

AUCtau (ng*h/mL)
  [Same statistics as above]

MRAUCtau
  [Same statistics as above]

MRCmax
  [Same statistics as above]
────────────────────────────────────────────────────────────────────────────────────────

Abbreviations: AUC0-8 = area under curve 0-8h; AUCtau = AUC over dosing interval;
  CL/F = apparent clearance; Cmax = maximum concentration; Ctrough = trough
  concentration; %CV = coefficient of variation; Max = maximum; Min = minimum;
  MRAUCtau = metabolite-to-parent AUC ratio; MRCmax = metabolite-to-parent Cmax ratio;
  N = total subjects; n = subjects with parameter; PK = pharmacokinetics;
  SD = standard deviation; Tmax = time to Cmax.
Note: BLQ values set to zero. BLQ excluded from geometric mean calculations.
Source: ADPP
Program: t_pk_param.sas
```

---

### T-14.4.5: Effect of Pembrolizumab on Crizotinib PK (Mixed-Effect Model)

```
Table T-14.4.5
Effect of Pembrolizumab on Crizotinib Pharmacokinetics (DL-1)
Mixed-Effect Model Analysis
Population: PK Parameter Analysis Set (DL-1) — Study A8081054
Layout: Portrait

                                  Crizotinib Alone    Combination      Ratio [a]     90% CI [b]
PK Parameter                      Adj. Geo Mean       Adj. Geo Mean    (Comb/Alone)
────────────────────────────────────────────────────────────────────────────────────────────────
AUCtau (ng*h/mL)                      xxxx                xxxx           x.xx      (x.xx, x.xx)
Cmax (ng/mL)                          xxxx                xxxx           x.xx      (x.xx, x.xx)
────────────────────────────────────────────────────────────────────────────────────────────────

[a] Geometric mean ratio: combination (Cycle 6 Day 1) / alone (Cycle -1 Day 15).
[b] 90% CI from mixed-effect model on log-transformed parameters with treatment
    as fixed effect and patient as random effect. Back-transformed to original scale.
Note: No effect boundary: 80%-125%.
Abbreviations: Adj. = adjusted; AUCtau = AUC over dosing interval; CI = confidence
  interval; Cmax = maximum concentration; Comb = combination; Geo = geometric;
  PK = pharmacokinetics.
Source: ADPP
Program: t_pk_ddi.sas
```

---

### T-14.4.6: Crizotinib Steady-State Ctrough by Visit and Ethnicity

```
Table T-14.4.6
Crizotinib Steady-State Trough Concentration Summary by Visit and Ethnicity
Population: PK Concentration Analysis Set — Study A8081054
Layout: Landscape

                                  Asian (N=xxx)             Non-Asian (N=xxx)          Total (N=xxx)
Visit                             n  Mean (SD)  Geo Mean    n  Mean (SD)  Geo Mean     n  Mean (SD)  Geo Mean
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Cycle 2 Day 1 (Ctrough)         xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
Cycle 4 Day 1 (Ctrough)         xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
Cycle 6 Day 1 (Ctrough)         xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
Cycle 8 Day 1 (Ctrough)         xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx

Mean Ctrough,ss [a]              xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)   xxxx     xx  xxxx (xxxx)  xxxx
──────────────────────────────────────────────────────────────────────────────────────────────────────────────

[a] Ctrough,ss,mean = arithmetic mean of individual Ctrough values from Cycle 2 onward.
Note: Concentrations in ng/mL.
Abbreviations: Ctrough = trough concentration; Geo Mean = geometric mean;
  N = total subjects; n = subjects with data; SD = standard deviation;
  ss = steady state.
Source: ADPC
Program: t_pk_ctrough_eth.sas
```

---

### T-14.5.1: PRO Instrument Compliance Rates

```
Table T-14.5.1
PRO Instrument Compliance Rates
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

                              QLQ-C30               QLQ-LC13              VSAQ-ALK
Visit                    Expected Completed (%)  Expected Completed (%)  Expected Completed (%)
──────────────────────────────────────────────────────────────────────────────────────────────────
Cycle 1 Day 1              xxx     xxx (xx.x)      xxx     xxx (xx.x)      xxx     xxx (xx.x)
Cycle 3 Day 1              xxx     xxx (xx.x)      xxx     xxx (xx.x)      xxx     xxx (xx.x)
Cycle 7 Day 1              xxx     xxx (xx.x)      xxx     xxx (xx.x)      xxx     xxx (xx.x)
Cycle 11 Day 1             xxx     xxx (xx.x)      xxx     xxx (xx.x)      xxx     xxx (xx.x)
...
End of Treatment           xxx     xxx (xx.x)      xxx     xxx (xx.x)      xxx     xxx (xx.x)
──────────────────────────────────────────────────────────────────────────────────────────────────

Note: Expected = subjects still on study at the visit window.
  Completed = subjects with at least one evaluable item on the instrument.
Abbreviations: PRO = patient-reported outcome; QLQ-C30 = Quality of Life
  Questionnaire Core 30; QLQ-LC13 = Lung Cancer module; VSAQ-ALK = Visual
  Symptom Assessment Questionnaire for ALK.
Source: ADQS
Program: t_pro_compl.sas
```

---

### T-14.5.2: EORTC QLQ-C30 and QLQ-LC13 Scores and Change from Baseline

```
Table T-14.5.2
EORTC QLQ-C30 and QLQ-LC13: Scores and Change from Baseline
Population: PRO Analysis Set — Study A8081054
Layout: Landscape

                                                Total (N=xxx)
                              ──────────────────────────────────────────
Domain / Visit                  n    Score           CFB           95% CI
                                     Mean (SD)       Mean (SD)     of CFB
─────────────────────────────────────────────────────────────────────────────
QLQ-C30 GLOBAL HEALTH STATUS / QOL
  Baseline                     xxx  xx.x (xx.x)        ---            ---
  Cycle 3                      xxx  xx.x (xx.x)     xx.x (xx.x)   (xx.x, xx.x)
  Cycle 7                      xxx  xx.x (xx.x)     xx.x (xx.x)   (xx.x, xx.x)
  ...

QLQ-C30 PHYSICAL FUNCTIONING
  Baseline                     xxx  xx.x (xx.x)        ---            ---
  Cycle 3                      xxx  xx.x (xx.x)     xx.x (xx.x)   (xx.x, xx.x)
  ...

QLQ-C30 ROLE FUNCTIONING
  [Same structure]

QLQ-C30 EMOTIONAL FUNCTIONING
  [Same structure]

QLQ-C30 COGNITIVE FUNCTIONING
  [Same structure]

QLQ-C30 SOCIAL FUNCTIONING
  [Same structure]

QLQ-C30 FATIGUE
  [Same structure]

QLQ-C30 NAUSEA AND VOMITING
  [Same structure]

QLQ-C30 PAIN
  [Same structure]

QLQ-LC13 DYSPNOEA
  [Same structure]

QLQ-LC13 COUGHING
  [Same structure]

QLQ-LC13 PAIN IN CHEST
  [Same structure]
─────────────────────────────────────────────────────────────────────────────

Note: Scores transformed to 0-100 scale per EORTC scoring manual.
  For functional scales, higher = better functioning. For symptom scales, higher = worse symptoms.
  A 10-point change from baseline is considered clinically meaningful.
  Visit windows per SAP Appendix 5.
Abbreviations: CFB = change from baseline; CI = confidence interval;
  EORTC = European Organisation for Research and Treatment of Cancer;
  N = total subjects; n = subjects with non-missing data; QOL = quality of life;
  SD = standard deviation.
Source: ADQS
Program: t_pro_scores.sas
```

---

### T-14.5.3: PRO Responder Analysis

```
Table T-14.5.3
PRO Responder Analysis: Improved, Stable, and Deteriorated
Population: PRO Analysis Set — Study A8081054
Layout: Landscape

                                                  Total (N=xxx)
                              ─────────────────────────────────────────────────
Domain / Visit                  n    Improved [a]     Stable         Deteriorated
                                     n (%)            n (%)          n (%)
───────────────────────────────────────────────────────────────────────────────────
QLQ-C30 GLOBAL HEALTH STATUS / QOL
  Cycle 3                      xxx    xx (xx.x)       xx (xx.x)      xx (xx.x)
  Cycle 7                      xxx    xx (xx.x)       xx (xx.x)      xx (xx.x)
  ...

[Additional domains]
───────────────────────────────────────────────────────────────────────────────────

[a] Improved = CFB >= +10 points (functional scales) or <= -10 points (symptom scales).
    Deteriorated = CFB <= -10 points (functional) or >= +10 points (symptom).
    Stable = absolute CFB < 10 points.
Abbreviations: CFB = change from baseline; N = total subjects; n = subjects with
  paired data; PRO = patient-reported outcome; QOL = quality of life.
Source: ADQS
Program: t_pro_resp.sas
```

---

### T-14.5.4: VSAQ-ALK Frequency Analysis

```
Table T-14.5.4
VSAQ-ALK: Visual Symptom Frequency Analysis
Population: PRO Analysis Set — Study A8081054
Layout: Landscape

                                                        Total (N=xxx)
                                            ──────────────────────────────────
                                            Baseline       Cycle 3        Cycle 7
VSAQ-ALK Item                               n (%)          n (%)          n (%)
──────────────────────────────────────────────────────────────────────────────────
Frequency of visual disturbances
  Never                                    xx (xx.x)      xx (xx.x)      xx (xx.x)
  Rarely                                   xx (xx.x)      xx (xx.x)      xx (xx.x)
  Sometimes                                xx (xx.x)      xx (xx.x)      xx (xx.x)
  Often                                    xx (xx.x)      xx (xx.x)      xx (xx.x)
  Very often                               xx (xx.x)      xx (xx.x)      xx (xx.x)

Degree of bothersomeness
  Not at all                               xx (xx.x)      xx (xx.x)      xx (xx.x)
  A little bit                             xx (xx.x)      xx (xx.x)      xx (xx.x)
  Somewhat                                 xx (xx.x)      xx (xx.x)      xx (xx.x)
  Quite a bit                              xx (xx.x)      xx (xx.x)      xx (xx.x)
  Very much                                xx (xx.x)      xx (xx.x)      xx (xx.x)

{Additional VSAQ-ALK items}
──────────────────────────────────────────────────────────────────────────────────

Abbreviations: N = total subjects; n = number of subjects; VSAQ-ALK = Visual
  Symptom Assessment Questionnaire for ALK.
Source: ADQS
Program: t_vsaq.sas
```

---

## Listing Shells

---

### L-16.3.0: DLT Listing by Dose Level

```
Listing L-16.3.0
Dose-Limiting Toxicity Listing by Dose Level
Population: DLT-Evaluable Population — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Crizotinib Dose | DLT Term (PT) | SOC |
  CTCAE Grade | Onset Day (from first dose) | Duration (days) |
  Serious (Y/N) | Relationship | Action Taken | Outcome

Sort order: By dose level (DL0, DL-1, DL-2, DL-3), then by subject ID

Note: DLTs defined per Protocol Section 3.2. Graded per NCI CTCAE v4.03.
  Observation period: first 2 cycles (42 days).
Source: ADAE (where DLTFL = 'Y')
Program: l_dlt.sas
```

---

### L-16.3.1: Death Listing

```
Listing L-16.3.1
Death Listing
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Age/Sex | Date of Last Dose (Crizotinib) |
  Date of Last Dose (Pembrolizumab) | Date of Death |
  Days from Last Crizotinib Dose | Days from Last Pembrolizumab Dose |
  Primary Cause of Death | On-treatment / Post-treatment [a] |
  Relationship to Study Drug

[a] On-treatment: <=28 days from last crizotinib or <=90 days from last pembrolizumab.

Sort order: By dose level, then by subject ID
Source: ADSL, ADAE
Program: l_death.sas
```

---

### L-16.3.4: Patients with Grade >=3 Laboratory Toxicities

```
Listing L-16.3.4
Patients with Grade >=3 Laboratory Toxicities
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Laboratory Parameter | Baseline Value |
  Baseline Grade | Worst Post-Baseline Value | Worst Grade |
  Visit of Worst Value | Action Taken | Resolved (Y/N)

Sort order: By dose level, laboratory parameter, subject ID
Source: ADLB
Program: l_lab_g3.sas
```

---

### L-16.2.1: Individual Patient Efficacy Data (Dose Finding Phase)

```
Listing L-16.2.1
Individual Patient Efficacy Data — Dose Finding Phase
Population: Safety Analysis Set / Response Evaluable — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Study Phase | Visit | Tumor Assessment Date |
  Sum of Target Lesion Diameters (mm) | % Change from Baseline |
  % Change from Nadir | Non-Target Lesion Status | New Lesions (Y/N) |
  Response at Visit | Best Overall Response | Confirmed (Y/N)

Sort order: By dose level, subject ID, visit date
Source: ADRS, ADTR
Program: l_eff_df.sas
```

---

### L-16.3.5: Other Laboratory Test Results

```
Listing L-16.3.5
Other Laboratory Test Results (Without CTCAE Definitions)
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Laboratory Parameter | Visit |
  Result Value | Unit | Reference Range (Low - High) | Flag (H/L/N)

Sort order: By laboratory parameter, dose level, subject ID, visit
Note: Includes coagulation, thyroid function, urinalysis, and other tests
  without NCI CTCAE v4.03 grading criteria.
Source: ADLB
Program: l_lab_other.sas
```

---

### L-16.1.1: Protocol Deviations Listing

```
Listing L-16.1.1
Protocol Deviations Listing
Population: All Enrolled Subjects — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Site | Deviation Category |
  Deviation Description | Date of Deviation | Impact on Analysis Population

Sort order: By dose level, site, subject ID
Note: Deviations related to statistical analyses or analysis population definitions.
Source: ADSL, clinical database
Program: l_protdev.sas
```

---

### L-16.1.2: Prior and Follow-up Systemic Therapy Listing

```
Listing L-16.1.2
Prior and Follow-up Systemic Therapy for Primary Diagnosis
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Therapy Type (Prior/Follow-up) |
  Therapy Name | Regimen | Start Date | End Date |
  Best Response to Therapy | Reason for Discontinuation

Sort order: By dose level, subject ID, therapy type, start date
Source: ADCM, clinical database
Program: l_prior_fu_ther.sas
```

---

### L-16.1.3: Prior and Concomitant Drug/Non-Drug Treatment Listings

```
Listing L-16.1.3
Prior and Concomitant Drug and Non-Drug Treatment Listings
Population: Safety Analysis Set — Study A8081054
Layout: Landscape

Columns:
  Subject ID | Dose Level | Treatment Name | ATC Class |
  Route | Start Date | End Date | Prior/Concomitant | Indication

Sort order: By dose level, subject ID, start date
Note: Separate listings for drug and non-drug treatments.
Source: ADCM
Program: l_cm.sas
```

---

## Figure Shells

---

### F-15.1.1: Kaplan-Meier Plot of PFS

```
Figure F-15.1.1
Kaplan-Meier Curve for Progression-Free Survival
Population: Safety Analysis Set — Study A8081054

[Description]
X-axis: Time (months) from first dose of study treatment
Y-axis: PFS probability (0.0 to 1.0)
Curves: Single curve (all treated subjects). If dose levels are distinguishable,
  overlay by dose level (DL0 = solid blue, DL-1 = dashed red,
  DL-2 = dotted green, DL-3 = dash-dot orange)
Censor marks: Tick marks on curve at censoring times
Legend: Dose level names with median PFS and 95% CI
Below plot: Number at Risk table by dose level at 0, 3, 6, 9, 12, 15, 18 months

Annotations:
  Median PFS: xx.x months (95% CI: xx.x, xx.x)
  6-month PFS rate: xx.x% (95% CI: xx.x, xx.x)
  12-month PFS rate: xx.x% (95% CI: xx.x, xx.x)
  18-month PFS rate: xx.x% (95% CI: xx.x, xx.x)

Note: Single-arm study; no comparative statistics.
  Progression assessed by investigator per RECIST v1.1.
Source: ADTTE (PARAMCD = PFS)
Program: f_km_pfs.sas
```

---

### F-15.1.2: Kaplan-Meier Plot of OS

```
Figure F-15.1.2
Kaplan-Meier Curve for Overall Survival
Population: Safety Analysis Set — Study A8081054

[Description]
X-axis: Time (months) from first dose of study treatment
Y-axis: OS probability (0.0 to 1.0)
Curves: Single curve (all treated subjects) or overlay by dose level
Censor marks: Tick marks at censoring times
Legend: Median OS and 95% CI
Below plot: Number at Risk table at 0, 3, 6, 9, 12, 15, 18 months

Annotations:
  Median OS: xx.x months (95% CI: xx.x, xx.x)
  12-month OS rate: xx.x% (95% CI: xx.x, xx.x)
  18-month OS rate: xx.x% (95% CI: xx.x, xx.x)

Source: ADTTE (PARAMCD = OS)
Program: f_km_os.sas
```

---

### F-15.1.3: Kaplan-Meier Plot of Duration of Response

```
Figure F-15.1.3
Kaplan-Meier Curve for Duration of Response
Population: Responders from Response Evaluable Analysis Set — Study A8081054

[Description]
X-axis: Time (weeks) from first confirmed objective response
Y-axis: Probability of remaining in response (0.0 to 1.0)
Curves: Single curve for all responders
Censor marks: Tick marks at censoring times
Legend: Median DR and 95% CI
Below plot: Number at Risk table

Annotations:
  N responders = xxx
  Median DR: xx.x weeks (95% CI: xx.x, xx.x)

Source: ADTTE (PARAMCD = DR)
Program: f_km_dr.sas
```

---

### F-15.3.1: Crizotinib Mean/Median Concentration-Time Plots

```
Figure F-15.3.1
Crizotinib Mean Plasma Concentration-Time Profiles
Population: PK Concentration Analysis Set — Study A8081054

[Description]
Two panels: (a) Linear-linear scale, (b) Log-linear scale
X-axis: Time post-dose (hours), 0 to 8h
Y-axis: Crizotinib plasma concentration (ng/mL)
Lines: One line per dose level (DL0, DL-1, DL-2, DL-3)
  with mean +/- SD error bars at each timepoint
Separate plots for each visit with full PK profile (Cycle -1 Day 15, Cycle 6 Day 1)

Note: For DL-1, Cycle -1 = crizotinib alone; Cycle 6 = combination.
Source: ADPC
Program: f_pk_conc_criz.sas
```

---

### F-15.3.2: Crizotinib Individual Concentration-Time Profiles

```
Figure F-15.3.2
Crizotinib Individual Plasma Concentration-Time Profiles
Population: PK Concentration Analysis Set — Study A8081054

[Description]
Separate panels by dose level and visit
X-axis: Time post-dose (hours), 0 to 8h
Y-axis: Crizotinib plasma concentration (ng/mL), log scale
Lines: One thin line per subject, mean/median overlay in bold
Color: Individual subjects in gray, mean in black

Source: ADPC
Program: f_pk_ind_criz.sas
```

---

### F-15.3.3: Pembrolizumab Mean/Median Concentration-Time Plots

```
Figure F-15.3.3
Pembrolizumab Mean Serum Concentration-Time Profiles
Population: PK Concentration Analysis Set — Study A8081054

[Description]
X-axis: Time post-infusion (hours/days)
Y-axis: Pembrolizumab serum concentration (ug/mL)
Lines: One line per dose level with mean +/- SD error bars
Separate panels for each cycle with intra-cycle PK sampling

Source: ADPC
Program: f_pk_conc_pembro.sas
```

---

### F-15.3.4: Ctrough Plots by Visit (Crizotinib and PF-06260182)

```
Figure F-15.3.4
Crizotinib and PF-06260182 Trough Concentration by Visit
Population: PK Concentration Analysis Set — Study A8081054

[Description]
Two panels: (a) Crizotinib, (b) PF-06260182
X-axis: Visit (Cycle 1 D1, Cycle 2 D1, Cycle 4 D1, Cycle 6 D1, Cycle 8 D1)
Y-axis: Ctrough (ng/mL), linear scale
Plot type: Line plot with median and mean markers
Separate lines by ethnicity (Asian vs. Non-Asian) if sufficient sample size

Note: Used to assess steady-state attainment and ethnicity-based PK differences.
Source: ADPC
Program: f_pk_ctrough.sas
```

---

### F-15.3.5: Pembrolizumab Trough Concentration Plots

```
Figure F-15.3.5
Pembrolizumab Trough Concentration by Visit
Population: PK Concentration Analysis Set — Study A8081054

[Description]
X-axis: Visit (Cycle 2 D1, Cycle 4 D1, Cycle 6 D1, Cycle 8 D1)
Y-axis: Pembrolizumab Ctrough (ug/mL)
Plot type: Box-whisker plot (box = Q1-Q3, whiskers = 1.5*IQR, median line)
  with individual data points overlaid
Separate panels or colors by dose level

Note: Used to assess pembrolizumab steady-state attainment.
Source: ADPC
Program: f_pk_trough_pembro.sas
```

---

### F-15.3.6: Box Plots for AUCtau and Cmax (Crizotinib, DL-1 Comparison)

```
Figure F-15.3.6
Box Plots of Crizotinib AUCtau and Cmax: Alone vs. Combination (DL-1)
Population: PK Parameter Analysis Set (DL-1) — Study A8081054

[Description]
Two panels: (a) AUCtau, (b) Cmax
X-axis: Treatment condition (Crizotinib Alone [Cycle -1 Day 15],
  Crizotinib + Pembrolizumab [Cycle 6 Day 1])
Y-axis: PK parameter value (ng*h/mL for AUCtau, ng/mL for Cmax)
Plot type: Box-whisker plot with geometric mean (diamond) and median (line) overlaid
Individual data points shown

Note: Assesses whether pembrolizumab affects crizotinib exposure.
  Same data as T-14.4.5 (mixed-effect model).
Source: ADPP
Program: f_pk_ddi_box.sas
```

---

### F-15.2.1: E-DISH Scatter Plots

```
Figure F-15.2.1
E-DISH Scatter Plots
Population: Safety Analysis Set — Study A8081054

[Description]
Two panels: (a) Maximum ALT vs. Maximum Total Bilirubin,
  (b) Maximum AST vs. Maximum Total Bilirubin
X-axis: Maximum ALT or AST (x ULN), log scale
Y-axis: Maximum Total Bilirubin (x ULN), log scale
Points: One per subject, colored by dose level
Reference lines: Vertical at 3x ULN (ALT/AST), Horizontal at 2x ULN (bilirubin)
Quadrant labels: Upper-right = potential Hy's Law cases

Note: Each point represents one subject's worst post-baseline values.
  Points in the upper-right quadrant (ALT/AST >3xULN AND TBili >2xULN)
  are flagged for further evaluation.
Source: ADLB
Program: f_edish.sas
```

---

### F-15.2.2: AE Duration Kaplan-Meier Plots

```
Figure F-15.2.2
Kaplan-Meier Plots of AE Duration for AEs of Special Interest
Population: Safety Analysis Set — Study A8081054

[Description]
Separate figure for each AE of special interest (if applicable)
X-axis: Duration of AE (days/weeks)
Y-axis: Probability of AE remaining unresolved (0.0 to 1.0)
Curves: Single curve per AE type
Censor marks: At last follow-up for unresolved events

Note: AEs of special interest to be determined based on safety data review.
  May include hepatotoxicity-related AEs or immune-related AEs.
Source: ADAE
Program: f_ae_dur.sas
```

---

## Recommendations and Gap Analysis

### Coverage Assessment

The 55 TLGs (36 tables, 8 listings, 11 figures) are appropriate for this Phase 1b oncology study. The package covers:

| Domain | Tables | Listings | Figures | Status |
|--------|--------|----------|---------|--------|
| Demographics / Disposition | 3 | 2 | 0 | Complete |
| Exposure | 1 | 0 | 0 | Complete |
| DLT (Primary Endpoint) | 1 | 1 | 0 | Complete |
| Safety (AE) | 7 | 1 | 1 | Complete |
| Safety (Labs) | 4 | 1 | 1 | Complete |
| Safety (Vital Signs) | 2 | 0 | 0 | Complete |
| Safety (ECG) | 2 | 0 | 0 | Complete |
| Safety (ECOG) | 1 | 0 | 0 | Complete |
| Safety (Deaths) | 1 | 1 | 0 | Complete |
| Efficacy (Response) | 1 | 1 | 0 | Complete |
| Efficacy (TTE) | 4 | 0 | 3 | Complete |
| PK | 6 | 0 | 6 | Complete |
| PRO | 4 | 0 | 0 | Complete |

### Potential Additions to Consider

1. **Immune-related AE tables** -- Given pembrolizumab (anti-PD-1), consider adding select AE / irAE tables by immune category (endocrine, GI, hepatic, pulmonary, skin). The SAP does not explicitly define these, but they are standard for anti-PD-1 combinations.

2. **Waterfall plot** -- A waterfall plot of best percent change in tumor diameter is standard for oncology Phase 1b/2 studies and would complement the BOR table (T-14.2.1).

3. **Swimmer plot** -- A swimmer plot showing individual subject treatment duration, response onset, and progression could be informative for this dose-finding study.

4. **Subsequent anti-cancer therapy table** -- The follow-up period collects subsequent therapies (L-16.1.2 listing exists), but a summary table would aid OS interpretation.

### Items Requiring Clarification

- Complete DLT definition criteria (Protocol Section 3.2) should be verified before finalizing the DLT table footnotes.
- CCI-redacted sections may contain additional biomarker/immunogenicity endpoints that would expand the TLG list.
- The VSAQ-ALK item structure should be confirmed against the actual questionnaire for T-14.5.4 row stubs.
