# TLG Catalog by Trial Phase

This reference lists the standard TLGs expected for each trial phase. Use it to ensure completeness when deriving a TLG list from metadata, or to gap-check an existing planned_tlg_list.

The lists below represent the **typical minimum** for each phase. The actual package may be larger depending on the study design, therapeutic area, and regulatory requirements.

## Table of Contents

1. [Universal TLGs (All Phases)](#universal-tlgs-all-phases)
2. [Phase 1 / Phase 1b Dose-Finding](#phase-1--phase-1b-dose-finding)
3. [Phase 2 Proof-of-Concept](#phase-2-proof-of-concept)
4. [Phase 3 Confirmatory](#phase-3-confirmatory)
5. [Conditional TLGs by Feature](#conditional-tlgs-by-feature)

---

## Universal TLGs (All Phases)

These TLGs appear in virtually every clinical study report regardless of phase.

### Tables

| Category | TLG ID Pattern | Title | Population | When to Include |
|----------|---------------|-------|------------|-----------------|
| Disposition | T-14.1.1 | Subject Disposition | All enrolled/randomized | Always |
| Demographics | T-14.1.2 | Demographics and Baseline Characteristics | Primary analysis set | Always |
| Medical History | T-14.1.3 | Medical History | Safety | Always |
| Prior/Concomitant Meds | T-14.1.4 | Prior and Concomitant Medications | Safety | Always |
| Exposure | T-14.1.5 | Study Drug Exposure / Treatment Administration | Safety | Always |
| AE Overview | T-14.3.1.1 | Overall Summary of Adverse Events | Safety | Always |
| TEAE by SOC/PT | T-14.3.1.2 | TEAEs by SOC, PT, and Maximum CTCAE Grade | Safety | Always |
| Related AEs | T-14.3.1.3 | Treatment-Related AEs by SOC, PT, and Grade | Safety | Always |
| SAEs | T-14.3.1.4 | Serious Adverse Events by SOC, PT | Safety | Always |
| AEs Leading to D/C | T-14.3.1.5 | AEs Leading to Treatment Discontinuation | Safety | Always |
| Deaths | T-14.3.1.6 | Deaths Summary | Safety | Always |
| Labs Summary | T-14.3.2.1 | Laboratory Abnormalities by Worst CTCAE Grade | Safety | Always |
| Lab Shift | T-14.3.2.2 | Laboratory Shift Table (Baseline vs. Worst Post-Baseline) | Safety | Always |
| Vital Signs | T-14.3.3.1 | Vital Signs Summary Statistics by Visit | Safety | Always |
| ECG | T-14.3.4.1 | ECG Parameters Summary | Safety | If ECG collected |

### Listings

| Category | TLG ID Pattern | Title | Population | When to Include |
|----------|---------------|-------|------------|-----------------|
| Deaths | L-16.3.1 | Death Listing | Safety | Always |
| SAEs | L-16.3.2 | Serious Adverse Events Listing | Safety | Always |
| AE D/C | L-16.3.3 | AEs Leading to Discontinuation Listing | Safety | Always |
| Protocol Deviations | L-16.1.1 | Protocol Deviations Listing | All enrolled | Always |

### Figures

None are truly universal, but KM curves for time-to-event primary/secondary endpoints are expected whenever those endpoints exist.

---

## Phase 1 / Phase 1b Dose-Finding

Phase 1 studies are safety- and PK-focused. The TLG package is smaller than Phase 2/3 but has distinctive elements.

### Additional Tables (beyond universal)

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| DLT Summary | T-14.3.1.0 | DLT Summary by Dose Level | **Critical for dose-finding**. Show DLT count/rate at each dose level. Columns = dose levels. |
| AE by Dose Level | T-14.3.1.2a | TEAEs by SOC/PT and Dose Level | Standard AE table but columns are dose levels, not treatment arms |
| AE by Cycle | T-14.3.1.7 | AE Summary by Cycle Period | Common in oncology Phase 1 (Cycle 1 vs 2 vs >=3) |
| AE Grade Groups | T-14.3.1.8 | TEAEs by PT and Grade Group (1-2, 3-4, 5) | Simplified severity view |
| Lab by Cycle | T-14.3.2.3 | Laboratory Abnormalities by Cycle Period | If cycle-specific safety monitoring |
| Liver (E-DISH) | T-14.3.2.4 | Liver Function Summary / E-DISH Criteria | If hepatotoxicity is a concern |
| ECG Shift | T-14.3.4.2 | ECG Shift Table (Baseline vs. Worst QTcF/QTcB) | If ECG monitoring is protocol-specified |
| ECG Categorical | T-14.3.4.3 | ECG QTc Categorical Analysis | QTcF >=500ms, delta >=60ms thresholds |
| Vital Signs Categorical | T-14.3.3.2 | Vital Signs Categorical Analysis | BP/pulse outlier thresholds |
| ECOG Shift | T-14.3.5.1 | ECOG Performance Status Shift Table | If ECOG assessed |
| PK Concentrations | T-14.4.1 | Plasma/Serum Concentrations by Visit and Dose Level | **Core Phase 1 table** |
| PK Parameters | T-14.4.2 | PK Parameter Summary (Cmax, AUC, Tmax, t1/2, CL/F) | **Core Phase 1 table** |
| Metabolite PK | T-14.4.3 | Metabolite Concentrations and Parameters | If metabolite measured |
| Drug Interaction | T-14.4.4 | Effect of Concomitant Drug on PK (Mixed-Effect Model) | If drug interaction assessed |
| PK by Ethnicity | T-14.4.5 | PK Trough Summary by Ethnicity/Race | If ethnicity PK analysis planned |
| Efficacy (Response) | T-14.2.1 | Best Overall Response Summary | If tumor response assessed |
| Efficacy (PFS) | T-14.2.2 | PFS Summary (Kaplan-Meier) | If PFS is an endpoint |
| Efficacy (OS) | T-14.2.3 | OS Summary (Kaplan-Meier) | If OS is an endpoint |
| Efficacy (DOR) | T-14.2.4 | Duration of Response Summary | If DOR is an endpoint |
| Efficacy (TTR) | T-14.2.5 | Time to Response Summary | If TTR is an endpoint |
| PRO Compliance | T-14.5.1 | PRO Instrument Compliance Rates | If PRO endpoints |
| PRO Scores | T-14.5.2 | PRO Scores and Change from Baseline | If PRO endpoints |
| PRO Responder | T-14.5.3 | PRO Responder Analysis | If PRO with responder threshold |
| PRO Special | T-14.5.4 | Special PRO Instrument Summary | If study-specific PRO (e.g., VSAQ-ALK) |

### Additional Listings

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| DLT | L-16.3.0 | DLT Listing by Dose Level | **Critical**. Patient-level DLT details |
| Grade >=3 Labs | L-16.3.4 | Patients with Grade >=3 Laboratory Toxicities | Common in Phase 1 |
| Efficacy Individual | L-16.2.1 | Individual Patient Efficacy Data | Often for dose-finding phase |
| Prior/Follow-up Therapy | L-16.1.2 | Prior and Follow-up Systemic Therapy | If oncology |
| Concomitant Meds | L-16.1.3 | Concomitant Medications Listing | Detailed listing |

### Additional Figures

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| PK Mean Conc-Time | F-15.3.1 | Mean/Median Concentration-Time Plots | Linear-linear and log-linear scales |
| PK Individual | F-15.3.2 | Individual Concentration-Time Profiles | By dose level |
| PK Trough | F-15.3.3 | Trough Concentration Plots by Visit | Assess steady state |
| PK Box Plots | F-15.3.4 | Box Plots of PK Parameters by Treatment/Dose | If drug interaction assessment |
| KM PFS | F-15.1.1 | Kaplan-Meier Plot of PFS | If PFS endpoint |
| KM OS | F-15.1.2 | Kaplan-Meier Plot of OS | If OS endpoint |
| KM DOR | F-15.1.3 | Kaplan-Meier Plot of DOR | If DOR endpoint |
| E-DISH | F-15.2.1 | E-DISH Scatter Plots (ALT/AST vs. Bilirubin) | If hepatotoxicity concern |
| AE Duration KM | F-15.2.2 | AE Duration Kaplan-Meier Plots | If AEs of special interest |

**Typical Phase 1 total: 35-60 TLGs** (25-40 tables, 5-10 listings, 5-12 figures)

---

## Phase 2 Proof-of-Concept

Phase 2 studies balance safety and efficacy. The package is moderately sized with more efficacy outputs than Phase 1.

### Additional Tables (beyond universal)

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| AE by Grade Threshold | T-14.3.1.7 | AEs by SOC/PT (Any Grade, Grade 3+, Grade 5) | Common summary view |
| AE Leading to Death | T-14.3.1.8 | AEs Leading to Death by SOC/PT | Separate from deaths summary |
| AE Leading to Interruption | T-14.3.1.9 | AEs Leading to Treatment Interruption | If dose modifications tracked |
| Select AEs (immune) | T-14.3.1.10 | Select Adverse Events by Category, PT, and Grade | **Critical for immunotherapy**: immune-related AE categories (Endocrine, GI, Hepatic, Pulmonary, Renal, Skin, Hypersensitivity) |
| Select AEs D/C | T-14.3.1.11 | Select AEs Leading to Discontinuation | By immune category |
| Serious Select AEs | T-14.3.1.12 | Serious Select AEs by Category | By immune category |
| Select AE Subgroup | T-14.3.1.13 | Select AE Incidence by Subgroup Risk Factors | If subgroup safety analysis |
| Lab Abnormal Values | T-14.3.2.3 | Laboratory Abnormal Values Frequency | At each time point |
| Liver Function Criteria | T-14.3.2.4 | Liver Function Test Criteria (Hy's Law) | ALT/AST vs bilirubin criteria |
| Immunologic Tests | T-14.3.2.5 | Immunologic Test Summary | If immunologic markers (CRP, ANA, RF) |
| Hormonal Tests | T-14.3.2.6 | Hormonal Test Summary (TSH, T3, T4) | If thyroid monitoring |
| Thyroid Function | T-14.3.2.7 | Thyroid Function Criteria | If immunotherapy |
| ECG Max Value Categories | T-14.3.4.3 | ECG Maximum Value Category Analysis | Clinical threshold categories |
| Anti-Drug Antibody | T-14.3.5.2 | Anti-Drug Antibody Summary | If immunogenicity assessed |
| Response Rate (Central) | T-14.2.1 | Response Rate (Centrally Assessed) with CI | **Primary for many Phase 2 oncology** |
| Response Rate (Inv) | T-14.2.1b | Response Rate (Investigator-Assessed) with CI | Sensitivity/secondary |
| BOR (Central) | T-14.2.2 | Best Overall Response (Centrally Assessed) | CR/PR/SD/PD/NE percentages |
| BOR (Inv) | T-14.2.2b | Best Overall Response (Investigator-Assessed) | If dual assessment |
| Subgroup ORR | T-14.2.3 | Subgroup Analysis of Response Rate | By pre-specified subgroup factors |
| OS Summary | T-14.2.4 | Overall Survival Summary (Kaplan-Meier) | Median, landmark rates |
| PFS (Central) | T-14.2.5 | PFS Summary - Centrally Assessed (Kaplan-Meier) | Median, landmark rates |
| PFS (Inv) | T-14.2.5b | PFS Summary - Investigator-Assessed (Kaplan-Meier) | If dual assessment |
| TTP | T-14.2.6 | Time to Progression Summary | If TTP endpoint |
| DOR | T-14.2.7 | Duration of Response Summary (Kaplan-Meier) | For responders |
| TTR | T-14.2.8 | Time to Response Summary | Descriptive statistics |
| PK Concentrations | T-14.4.1 | Serum/Plasma Concentrations by Visit | If PK collected |

### Additional Listings

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| All AEs | L-16.3.5 | Listing of All Adverse Events | Full AE listing |
| AE Leading to Death | L-16.3.6 | AEs Leading to Death Listing | Individual detail |
| AE Interruption | L-16.3.7 | AEs Leading to Treatment Interruption | If tracked |
| Select AEs | L-16.3.8 | Select (Immune-Related) AEs Listing | If immunotherapy |
| Tumor Response | L-16.2.1 | Individual Tumor Response Assessment Listing | Patient-level response over time |

### Additional Figures

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| KM OS | F-15.1.1 | Kaplan-Meier Curve for OS | By histology/cohort if applicable |
| KM PFS (Central) | F-15.1.2 | Kaplan-Meier Curve for PFS (Central) | By histology/cohort |
| KM PFS (Inv) | F-15.1.3 | Kaplan-Meier Curve for PFS (Investigator) | If dual assessment |
| KM TTP | F-15.1.4 | Kaplan-Meier Curve for TTP | If TTP endpoint |
| Waterfall | F-15.1.5 | Waterfall Plot - Best Percent Change in Tumor Diameter | **Common oncology Phase 2 figure** |
| Spider | F-15.1.6 | Spider Plot - Percent Change Over Time | Individual subject trajectories |
| KM Select AE | F-15.2.1 | Kaplan-Meier Curve for Time to Select AEs | If immunotherapy |
| KM Grade 3+ AE | F-15.2.2 | Kaplan-Meier Curve for Time to Grade 3+ AEs | If safety is major focus |

**Typical Phase 2 total: 40-65 TLGs** (30-45 tables, 5-10 listings, 5-10 figures)

---

## Phase 3 Confirmatory

Phase 3 studies have the most extensive reporting package with formal hypothesis testing, multiple populations, and comprehensive subgroup analyses.

### Additional Tables (beyond universal)

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| Disposition by Region | T-14.1.1b | Subject Disposition by Region/Country | If multinational |
| Demographics Subpop | T-14.1.2b | Demographics - Subpopulation | If pre-specified regional subset |
| Stratification | T-14.1.6 | Randomization Stratification Summary | Actual vs. planned strata |
| Subsequent Therapy | T-14.1.7 | Subsequent Anti-Cancer Therapy | If oncology |
| Exposure by Period | T-14.1.5b | Drug Exposure by Treatment Period | Induction vs. maintenance |
| AE by Period | T-14.3.1.7 | TEAEs by Treatment Period | If multi-period design |
| AE Dose Modifications | T-14.3.1.8 | AEs Leading to Dose Modification/Reduction | If dose modifications allowed |
| irAE Summary | T-14.3.1.9 | Immune-Related AE Summary | If immunotherapy |
| imAR Summary | T-14.3.1.10 | Immune-Mediated Adverse Reactions | If sponsor-adjudicated |
| irAE by Subcategory | T-14.3.1.11 | irAEs by Subcategory (GI/Liver/Skin/Endo/Neuro/Other) | 6+ subtables |
| Lab by Period | T-14.3.2.3 | Laboratory Abnormalities by Treatment Period | If multi-period |
| Vital Signs Categorical | T-14.3.3.2 | Vital Signs Categorical Analysis | BP/pulse/weight thresholds |
| ECOG Shift | T-14.3.5.1 | ECOG Performance Status Shift Table | If ECOG assessed |
| **Primary Efficacy** | T-14.2.1 | **Primary Endpoint Analysis** | **Most important table** -- formal test results, HR/OR, CI, p-value |
| OS KM Summary | T-14.2.2 | Overall Survival Summary (Kaplan-Meier) | Median, HR, CI, p-value, landmark rates |
| OS Subpopulation | T-14.2.2b | OS Summary - Subpopulation | If pre-specified regional subset |
| PFS Summary | T-14.2.3 | PFS Summary (Kaplan-Meier) | Median, HR, CI, p-value, landmark rates |
| PFS Subpopulation | T-14.2.3b | PFS Summary - Subpopulation | If pre-specified regional subset |
| BORR | T-14.2.4 | Best Overall Response Rate with CI | If response is an endpoint |
| DCR | T-14.2.5 | Disease Control Rate | CR+PR+SD |
| DOR | T-14.2.6 | Duration of Response (KM) | For responders |
| Subgroup Forest | T-14.2.7 | Subgroup Analysis of Primary Endpoint | HR/OR by subgroup with forest plot data |
| Sensitivity Primary | T-14.2.8 | Sensitivity Analyses of Primary Endpoint | Stratified, covariate-adjusted |
| PRO LCSS/EQ-5D | T-14.5.1 | Patient-Reported Outcome Summary | If PRO endpoints |
| Time to Symptom | T-14.5.2 | Time to Symptom Progression | If symptom endpoint |

### Additional Listings

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| All AEs | L-16.3.5 | Listing of All AEs | Complete |
| irAEs | L-16.3.6 | Immune-Related AE Listing | If immunotherapy |
| Subsequent Therapy | L-16.1.2 | Subsequent Anti-Cancer Therapy Listing | If oncology |

### Additional Figures

| Category | TLG ID Pattern | Title | Notes |
|----------|---------------|-------|-------|
| **KM Primary** | F-15.1.1 | **Kaplan-Meier Curve for Primary Endpoint** | **Most important figure** |
| KM OS | F-15.1.2 | Kaplan-Meier Curve for OS | With number at risk table |
| KM PFS | F-15.1.3 | Kaplan-Meier Curve for PFS | With number at risk table |
| KM Subpopulation | F-15.1.4 | KM Curve for Primary Endpoint - Subpopulation | If regional subset |
| Forest Plot | F-15.1.5 | Forest Plot of Subgroup Analyses | **Critical Phase 3 figure** -- HR + CI by subgroup |
| Waterfall | F-15.1.6 | Waterfall Plot | If tumor response measured |

**Typical Phase 3 total: 50-100+ TLGs** (35-70 tables, 5-15 listings, 8-20 figures)

---

## Conditional TLGs by Feature

These TLGs are added when specific study features are present in the metadata.

### By study feature

| Feature | Additional TLGs | Trigger (metadata field) |
|---------|-----------------|--------------------------|
| Randomized | Stratification summary, treatment comparison columns | `study_design.randomized == true` |
| Double-blind | Unblinding summary table | `study_design.blinding == "double-blind"` |
| Multiple cohorts | Separate TLGs by cohort or cohort columns | `study_design.cohorts` is non-empty |
| Regional subset (e.g., China) | Duplicate key efficacy/safety TLGs for subset | `populations.other_populations` with regional entries |
| Interim analysis | Interim analysis summary table | `statistical_analyses.interim_analyses` is non-empty |
| PK endpoints | Full PK table/figure set | `endpoints` contains `type: "pharmacokinetic"` |
| PRO endpoints | PRO compliance, scores, responder tables | `endpoints` contains `type: "PRO"` |
| Biomarker endpoints | Biomarker summary, biomarker-by-response tables | `endpoints` contains `type: "biomarker"` |
| Immunotherapy | Select AE / irAE / imAR tables | Safety endpoints mention immune-related categories |
| Dose modifications allowed | Dose modification summary, AEs leading to modification | Treatment regimen allows dose reduction/interruption |
| Central + investigator assessment | Duplicate efficacy TLGs for both assessors | Multiple assessment types in endpoints |
| Subgroup analyses pre-specified | Forest plot, subgroup-specific tables | `statistical_analyses.subgroup_analyses` is non-empty |
| Adaptive design (mTPI, 3+3) | DLT decision matrix, dose escalation summary | `study_design.adaptive == true` |
