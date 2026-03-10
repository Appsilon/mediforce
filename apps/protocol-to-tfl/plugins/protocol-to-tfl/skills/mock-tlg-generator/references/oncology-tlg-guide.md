# Oncology-Specific TLG Guide

This reference covers TLG requirements specific to oncology trials. Read it whenever the metadata indicates `therapeutic_area: "Oncology"` or the indication involves cancer.

## Table of Contents

1. [RECIST Response Tables](#recist-response-tables)
2. [Time-to-Event Endpoints (OS, PFS, DFS, EFS)](#time-to-event-endpoints)
3. [Oncology-Specific Safety](#oncology-specific-safety)
4. [Immunotherapy-Specific TLGs](#immunotherapy-specific-tlgs)
5. [Oncology Figures](#oncology-figures)
6. [Disease-Specific Baseline Characteristics](#disease-specific-baseline-characteristics)
7. [Oncology-Specific Listings](#oncology-specific-listings)
8. [Subsequent Anti-Cancer Therapy](#subsequent-anti-cancer-therapy)

---

## RECIST Response Tables

Oncology trials measuring tumor response need tables aligned with RECIST v1.1 (or iRECIST for immunotherapy). Key distinctions:

### Central vs. Investigator Assessment
Many Phase 2-3 oncology trials use both central imaging review and investigator assessment. When the metadata shows:
- `endpoint.measurement` mentions "central" or "independent review" → create duplicate response tables for both assessors
- Label clearly: "Centrally Assessed" vs. "Investigator-Assessed"
- Central assessment is typically the primary; investigator is the sensitivity

### Confirmed vs. Unconfirmed Response
Check the endpoint description for whether responses must be confirmed (repeat scan at least 4 weeks later):
- **Confirmed**: Most Phase 2 primary endpoints and Phase 3. BOR requires 2 consecutive assessments of CR or PR.
- **Unconfirmed**: Sometimes used in Phase 1 or exploratory analyses. Specify in the table footnotes.

### Response Categories
Standard RECIST v1.1 categories for Best Overall Response:
- CR (Complete Response)
- PR (Partial Response)
- SD (Stable Disease)
- PD (Progressive Disease)
- NE (Not Evaluable) / Missing
- Early Death (died before first post-baseline assessment)
- IND (Indeterminate) — sometimes used

Derived rates:
- **ORR** = CR + PR (with CI)
- **DCR** = CR + PR + SD (with CI, sometimes requiring SD duration >= x weeks)
- **CBR** = CR + PR + durable SD (if defined)

### CI Method for Response Rates
Common methods — check the SAP:
- **Wilson**: Most common in oncology (used by BMS, Ono, many Japanese studies)
- **Clopper-Pearson (exact)**: Conservative, used by some sponsors
- **F-distribution based (exact)**: Equivalent to Clopper-Pearson, used by Pfizer
- **Wald**: Less common, not recommended for small samples

Always specify the CI method in the footnote.

---

## Time-to-Event Endpoints

### Overall Survival (OS)
- **Event**: Death from any cause
- **Censor**: Last known alive date
- **Time unit**: Usually months (days / 30.4375)
- **Landmark rates**: 6-month, 12-month, 18-month, 24-month OS rates
- **Table elements**: Events n(%), censored n(%), median (95% CI), HR (95% CI), p-value, landmark rates
- **Figure**: KM curve with number at risk table

### Progression-Free Survival (PFS)
- **Event**: Disease progression (per RECIST/mWHO/iRECIST) or death
- **Censor rules are complex** — check SAP Tables for censoring scenarios:
  - No baseline tumor assessment → censor at randomization/first dose
  - Missed assessments before PD → various approaches (use date of PD, or censor at last adequate assessment)
  - New anti-cancer therapy before PD → censor at last assessment before therapy (common) or treat as event (less common)
- **Assessment-specific**: Create separate PFS tables for central vs. investigator if both exist
- **Landmark rates**: 3-month, 6-month, 9-month, 12-month PFS rates (varies by study)

### Duration of Response (DOR)
- **Population**: Only responders (confirmed CR or PR)
- **Event**: PD or death after confirmed response
- **Time origin**: Date of first confirmed response (NOT randomization/first dose)
- **Landmark rates**: 6-month, 12-month DOR rates

### Time to Response (TTR)
- **Population**: Only responders
- **Measurement**: Time from first dose/randomization to first confirmed response
- **Analysis**: Usually descriptive statistics (median, range), sometimes KM

### Time to Progression (TTP)
- **Event**: PD only (death is censored, not an event)
- **Difference from PFS**: Deaths without PD are censored

### Disease-Free Survival (DFS) / Event-Free Survival (EFS)
- Adjuvant setting equivalents of PFS
- Events may include: recurrence, new primary cancer, death

### Median CI Methods
- **Brookmeyer-Crowley**: Based on log-log transformation of survival function
- **Log-log transformation**: Most common default
- **Linear transformation**: Less common
- Specify the method in footnotes

---

## Oncology-Specific Safety

### CTCAE Grading
- Always specify the CTCAE version (v3.0, v4.0, v4.03, v5.0)
- Grade 1-2 are mild-moderate; Grade 3-4 are severe/life-threatening; Grade 5 is death
- Standard grade groupings: Any Grade, Grade 1-2, Grade 3-4, Grade 5
- Some tables use: Grade 1, Grade 2, Grade 3, Grade 4, Grade 5 (full breakdown)

### AE Reporting Windows
Oncology trials often have complex AE reporting windows because of multiple drugs and long follow-up:
- Treatment-emergent: first dose through X days after last dose
- Different windows for different drugs (e.g., 28 days after last chemo, 90 days after last immunotherapy)
- Include the window definition in footnotes

### AE Sorting
- **By decreasing frequency**: Sort PTs by frequency in the reference arm (comparative) or total (single-arm)
- **By SOC alphabetical, PT by frequency within SOC**: Most common format
- Use the metadata to determine the reference group

### Deaths Summary
Standard oncology deaths table includes:
- On-treatment deaths (within reporting window)
- Post-treatment deaths (beyond reporting window)
- Cause of death: disease progression, AE, other, unknown
- Time from last dose to death

### E-DISH Plots (Drug-Induced Serious Hepatotoxicity)
- Scatter plot: Maximum ALT (or AST) on X-axis vs. Maximum Total Bilirubin on Y-axis
- Both axes in multiples of ULN
- Quadrant lines at ALT=3xULN and TBili=2xULN
- Points in upper-right quadrant are potential Hy's Law cases
- Required for most hepatotoxic drugs

---

## Immunotherapy-Specific TLGs

When the metadata mentions anti-PD-1, anti-PD-L1, anti-CTLA-4, or other immunotherapy agents, add these TLGs:

### Immune-Related Adverse Events (irAEs)
Group AEs by immune-related categories:
1. **Endocrine** (thyroid disorders, adrenal insufficiency, hypophysitis, diabetes)
2. **Gastrointestinal** (colitis, diarrhea)
3. **Hepatic** (hepatitis, transaminitis)
4. **Pulmonary** (pneumonitis, ILD)
5. **Renal** (nephritis)
6. **Skin** (rash, pruritus, vitiligo, dermatitis)
7. **Hypersensitivity/Infusion reactions**
8. **Neurological** (neuropathy, myasthenia, encephalitis) — sometimes included
9. **Other** (myocarditis, uveitis, pancreatitis)

For each category, provide:
- Table of AEs by PT and grade within the category
- Time to onset (KM figure or descriptive statistics)
- Duration of event
- Treatment for the event (systemic steroids, other immunosuppressants)
- Outcome (resolved, ongoing, etc.)

### Immune-Mediated Adverse Reactions (imARs)
- Similar to irAEs but adjudicated by the sponsor using clinical algorithms
- Distinguished from investigator-assessed irAEs
- Subcategories: enterocolitis, hepatitis, dermatitis, endocrinopathies, neuropathies, other
- Require separate tables if defined in the SAP

### Select AE Subgroup Analysis
For immunotherapy, common to analyze irAE/select AE incidence by subgroups:
- Prior autoimmune disease (yes/no)
- Baseline thyroid function
- Baseline hepatic function
- Concurrent medications (steroids at baseline)

### Anti-Drug Antibody (ADA) / Immunogenicity
If the metadata includes an ADAS population or mentions immunogenicity:
- Table: Proportion of ADA-positive vs. negative subjects
- Categories: baseline positive, treatment-emergent positive (persistent, transient), neutralizing positive
- Impact on efficacy (response rate by ADA status)
- Impact on safety (AE incidence by ADA status)

---

## Oncology Figures

### Kaplan-Meier Curves
- **Number at risk table**: Always include below the plot. Show at regular intervals (e.g., every 3 months for OS, every 2 months for PFS)
- **Tick marks**: Censoring marks on curves
- **Annotations**: Median, HR, CI, p-value (if comparative)
- **Color/line conventions**: Solid for experimental, dashed for control. Blue vs. red is common.
- For **multiple cohorts** (e.g., squamous vs. non-squamous): either separate figures or overlay with legend

### Waterfall Plot
- **Purpose**: Show best percent change in tumor burden for each subject
- **Ordering**: Left to right from most shrinkage to most growth
- **Reference lines**: -30% (PR threshold), +20% (PD threshold)
- **Bar coloring**: By BOR category (CR=green, PR=blue, SD=yellow, PD=red) or by treatment arm
- **Population**: Subjects with measurable disease at baseline and at least one post-baseline assessment
- **Axis**: Y-axis = best percent change from baseline (%), X-axis = individual subjects (no labels)

### Spider Plot (Spaghetti Plot)
- **Purpose**: Show individual subject tumor burden trajectories over time
- **X-axis**: Time from first dose (weeks or cycles)
- **Y-axis**: Percent change from baseline in sum of target lesion diameters (%)
- **Lines**: One per subject, colored by BOR or treatment arm
- **Reference lines**: -30%, +20%
- **Exclusions**: Assessments after PD or new therapy typically excluded

### Swimmer Plot
- **Purpose**: Show duration and timing of response for individual subjects
- **Y-axis**: Individual subjects (horizontal bars), ordered by duration on treatment
- **X-axis**: Time (weeks or months)
- **Bar**: Duration of treatment/follow-up
- **Symbols**: Triangle for response onset, X for progression, circle for ongoing
- **Color**: By BOR or dose level
- Less commonly required in SAPs but often requested by reviewers

### Forest Plot
- **Layout**: Landscape
- **Left column**: Subgroup name and n/N per arm
- **Center**: Point estimate (square/diamond) with horizontal CI line; vertical reference at HR=1 or OR=1
- **Right column**: Numeric estimate (95% CI)
- **Bottom label**: "Favors [Arm A] ← | → Favors [Arm B]"
- **Subgroups**: From `statistical_analyses.subgroup_analyses` in metadata

### Concentration-Time Plots (PK)
- **Linear-linear and log-linear scales**: Often both required
- **Individual profiles**: Overlay or separate panels by dose level
- **Mean/median profiles**: With error bars (SD or SEM)
- **Trough concentration plots**: Box-whisker or line plots by visit to assess steady state

---

## Disease-Specific Baseline Characteristics

For oncology trials, the demographics table should include disease-specific rows. Derive these from the metadata's indication and study design:

### NSCLC (Non-Small Cell Lung Cancer)
- Histology (squamous / non-squamous / adenocarcinoma / large cell / other)
- Disease stage at diagnosis (IIIB / IV / recurrent)
- EGFR mutation status (positive / negative / unknown)
- ALK translocation status (positive / negative / unknown)
- PD-L1 expression level (>=50% / 1-49% / <1% / unknown)
- Smoking status (current / former / never) and pack-years
- Number of prior systemic therapy lines (0 / 1 / 2 / >=3)
- Prior immunotherapy (yes / no)
- Brain metastases (yes / no)
- Bone metastases (yes / no)
- Liver metastases (yes / no)

### Breast Cancer
- Hormone receptor status (ER+/PR+ / ER-/PR-)
- HER2 status (positive / negative)
- Triple-negative status
- Disease stage
- Prior lines of therapy
- Visceral vs. non-visceral disease

### Melanoma
- BRAF mutation status (V600E / V600K / wild-type)
- LDH level (normal / elevated)
- Disease stage (III unresectable / IV M1a / M1b / M1c)
- Prior immunotherapy
- Brain metastases

### General Solid Tumors
- ECOG performance status (0 / 1 / 2)
- Number of metastatic sites
- Sites of metastases (lung / liver / bone / brain / other)
- Prior lines of therapy
- Time since diagnosis

---

## Oncology-Specific Listings

### Individual Tumor Response Listing
Columns: Subject ID | Treatment | Baseline Sum of Diameters | Visit | Sum of Diameters | % Change from Baseline | % Change from Nadir | Response at Visit | Best Overall Response

### Subsequent Anti-Cancer Therapy Listing
Columns: Subject ID | Treatment Arm | Therapy Name | Regimen | Start Date | End Date | Best Response to Subsequent Therapy

### Deaths Listing
Columns: Subject ID | Treatment Arm | Age/Sex | Date of Last Dose | Date of Death | Days from Last Dose | Primary Cause of Death | Relationship to Study Drug

---

## Subsequent Anti-Cancer Therapy

For oncology trials, track therapies received after study discontinuation:

### Table: Subsequent Systemic Therapy Summary
```
                                        [Arm A]        [Arm B]
                                        (N=xxx)        (N=xxx)
────────────────────────────────────────────────────────────────
Received subsequent therapy, n (%)    xxx (xx.x)     xxx (xx.x)

Type of therapy, n (%)
  Immunotherapy                        xx (xx.x)      xx (xx.x)
  Chemotherapy                         xx (xx.x)      xx (xx.x)
  Targeted therapy                     xx (xx.x)      xx (xx.x)
  Radiation therapy                    xx (xx.x)      xx (xx.x)
  Surgery                              xx (xx.x)      xx (xx.x)

Specific agents, n (%)
  {Agent 1}                            xx (xx.x)      xx (xx.x)
  {Agent 2}                            xx (xx.x)      xx (xx.x)
────────────────────────────────────────────────────────────────
```

This is important for OS analysis interpretation -- if one arm received more subsequent active therapy, it can confound OS results.
