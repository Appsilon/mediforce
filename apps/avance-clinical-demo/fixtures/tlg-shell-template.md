# Predefined TLG Template Layout (Demo Case 3 input)

This is the "predefined template layout" the `generate-tfl` step consumes. It uses the same
mock-TLG-shell format the `adam-to-tlg` skill already understands, so the agent reads it directly.
Two shells are provided: one table, one figure.

---

## T-1: Demographics and Baseline Characteristics

- **Type**: Table
- **Population**: Safety (SAFFL = "Y")
- **Source**: ADSL
- **Columns**: Placebo (N=xx) | Xanomeline Low Dose (N=xx) | Xanomeline High Dose (N=xx) | Total (N=xx)
- **Rows (stubs)**:
  - Age (y): n, Mean (SD), Median, Min, Max
  - Age category (AGEGR1): <65, 65-80, >80 — n (%)
  - Sex (SEX): each category — n (%)
  - Race (RACE): each category — n (%)
- **Statistics**: descriptive only (no hypothesis test)
- **Footnotes**:
  - "N is the number of subjects in the Safety population."
  - "Percentages are based on the number of subjects in each treatment group."
- **Programming notes**: Population N must be computed from ADSL (one row per subject).

---

## F-1: Mean Change from Baseline Over Time

- **Type**: Figure
- **Population**: Efficacy (EFFFL = "Y")
- **Source**: ADQS (or the efficacy BDS dataset present)
- **X axis**: Analysis Visit (AVISIT, ordered)
- **Y axis**: Mean change from baseline (CHG) with 95% CI error bars
- **Series**: one line per treatment arm (TRT01P)
- **Statistics**: mean and 95% CI per visit per arm
- **Footnotes**:
  - "Error bars represent 95% confidence intervals."
  - "Based on the Efficacy population."
- **Output**: PNG, 300 DPI, ~10x7 inches
