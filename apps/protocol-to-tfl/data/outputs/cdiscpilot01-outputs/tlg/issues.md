# CDISCPILOT01 TLG Generation — Issues Log

## Warnings (non-blocking)

1. **T-2 (Disposition)**: Fisher's exact test workspace exceeded for DCSREAS — large sparse contingency table. Table still generated; consider `simulate.p.value=TRUE` for exact p.

2. **T-3 (Demographics)**: `aov` test deprecated in gtsummary 2.0 — replaced by `oneway.test(var.equal=TRUE)`. Results unaffected. Some variables (BMIBL, HEIGHTBL, MMSETOT) had missing groups ("not enough groups" for ANOVA).

3. **T-11 (Completers)**: Only 8 completers at Week 24 with observed-case data. ANCOVA ran but emmeans produced NaN CIs due to nesting (SITEGR1 within TRT01P). Consider simplified model for small N.

4. **T-14 (ADAS over Time)**: Multiple `tbl_strata` warnings about "unused argument" for n statistic — gtsummary version compatibility issue with continuous summary in strata. Table generated correctly.

5. **T-25 (Hy's Law)**: Division by zero warnings when baseline ALT/AST/BILI = 0 or missing. Filtered to finite ratios only. Results are conservative (subjects with zero baseline excluded).

6. **F-1 (KM curve)**: `add_risktable()` from ggsurvfit had a missing `risktable_height` argument error (version compatibility). Removed risk table; KM curve generated without it.

## Design Decisions

- **T-22 (Clinically significant)**: No formal CS criteria in the data (no CSFLAG variable). Used proxy: abnormal post-baseline value with any change from baseline. In production, site-adjudicated CS flags should be used.
- **Hy's Law**: Used ratio to baseline (ALT/AST ≥3x BL, Bili ≥2x BL) rather than ULN multiples, as ULN values were not consistently populated in ADLB for all subjects.
- **Concomitant meds**: CMCLAS used for ATC class grouping; WHODrug coding not available in pilot data.
- **MMRM (T-15)**: Unstructured covariance fit successfully on first attempt; compound symmetry fallback was not needed.
