# Test run — Protocol → USDM → SDTM → Synthetic SDTM

End-to-end MVP demonstration of the **SDTM-first** pipeline on one real trial, using the **ctgov**
and **cdisclib** MCPs/clients. Pick a registered trial that has a protocol PDF, represent it in
**USDM v3.0**, resolve the **SDTM** datasets it implies, generate **populated synthetic SDTM
datasets** under the resolved constraints, and validate them with **CORE** — with traceability from
every synthetic cell back to the source protocol.

> SDTM-first: the pipeline resolves SDTM Dataset Specializations and generates SDTM directly, then
> runs CORE on it. There is no CDASH collection layer and no CDASH→SDTM tabulation hop (the earlier
> CDASH-first path was reverted — see `protocol-to-synthetic-sdtm-spec.md` §0.2.0).

## Chosen trial

**NCT04556760** — *"A Phase 2a Randomised, Double Blind, Multi-centre Study to Assess the Effect
on Glucose Homeostasis of Two Dose Levels of AZD9567, Compared to Prednisolone, in Adults With
Type 2 Diabetes"* (AstraZeneca, study `D6470C00005`).

Chosen because it (a) has a **Study Protocol PDF** (+ SAP) attached on CT.gov, (b) is a clean
industry trial with a rich, well-structured **Schedule of Activities** (MMTT glucose/insulin/
hormone sampling, CGM, PK, safety labs, vitals, ECG, urine electrolytes), and (c) is a two-way
**crossover** — which exercises epochs/visits and the EX (exposure) domain meaningfully.

## How to reproduce

```bash
# Stage 1 (fetch) was done via the ctgov MCP + curl into 00_raw/ and protocol/.
python 01_build_usdm.py            # Stage 2: CT.gov record + protocol SoA -> USDM v3.0
python 02_build_sdtm_spec.py       # Stage 4: SDTM spec from SDTMIG 3.4 structure + pinned CT
python 03_generate_synthetic_sdtm.py   # Stage 5: populate synthetic SDTM (seed 1234)
python 04_validate.py              # Stage 6a: light checks (CT membership, keys, provenance)
python 05_write_manifest.py        # manifest with versions + content hashes
./07_core_report/run_core_validation.sh   # Stage 6b: export XPT + CORE (-s sdtmig -v 3-4)
python 07_core_summary.py          # categorized digest -> 07_core_report/summary.json
```

With `CDISC_API_KEY` set, `02_build_sdtm_spec.py` can resolve SDTM Dataset Specializations live via
`cdisclib`; the default run is fully offline, reusing the pinned CT snapshot (`ct_snapshot/`).

## Steps & artifacts

| Stage | What happened | Tool | Output |
|-------|---------------|------|--------|
| **1. Fetch** | Pulled the verbatim CT.gov v2 record and downloaded the protocol PDF (CT.gov CDN). Captured API `dataTimestamp` for provenance. | **ctgov MCP** + CDN | `00_raw/NCT04556760.json`, `protocol/Prot_000.pdf` |
| **2. USDM** | Mapped enumerated registry fields deterministically; **read the protocol Schedule of Activities (pp.20–24)** to extract the visit grid + activity list. Assembled a USDM v3.0-structured study. | reading + deterministic build | `01_usdm/usdm.json`, `01_usdm/soa.json` |
| **4. SDTM spec** | For each SDTM domain the USDM activities imply, assembled the per-domain SDTM variable spec (name, label, role, dataType, codelist, mandatory) from the SDTMIG 3.4 structure, plus each coded variable's **Controlled Terminology** (pinned `sdtmct-2026-03-27`). Attached USDM-activity + protocol-page provenance. | **cdisclib** (CT) / SDTMIG template | `02_sdtm_spec/sdtm_spec.json`, `ct_cache.json`, `coverage.json` |
| **5. Populate** | Generated **40 subjects** across the 3 cohorts (24/8/8) with AB/BA crossover sequences. Coded values sampled from the pinned CT; numeric results within plausible clinical ranges; SDTM identifiers, `--SEQ`, `--DTC`, `EPOCH`, study-day `--DY`, and `RFSTDTC/RFXSTDTC` derived deterministically (seed 1234). Provenance kept in the `lineage.json` sidecar. | deterministic, seeded | `03_synthetic_sdtm/*.csv` (+ `_datasets.csv`, `_variables.csv`, `lineage.json`, `datasets_summary.json`) |
| **6a. Validate** | Checked mandatory identifiers, key uniqueness (`USUBJID + --SEQ`), CT membership of coded variables, and provenance completeness. | deterministic | `03_synthetic_sdtm/validation_report.json` |
| **6b. CORE** | Exported the SDTM to XPT v5 and ran the CDISC Rules Engine against SDTMIG 3.4. | XPT export + **CORE** | `06_sdtm_xpt/*.xpt`, `07_core_report/{core_sdtmig34.json, .xlsx, summary.json}` |

## SDTM datasets produced (SDTMIG 3.4)

Implied by the USDM activities: `DM, IE, MH, VS, EG, LB, EX, CM, AE, DS, PC, PE, SU`.
**Populated** (8): `DM, VS, LB, EX, CM, AE, DS, MH` — **3,129 rows total**.
**Deferred** (resolvable, not populated this run): `EG` (ECG), `PC` (PK concentrations), `PE`
(physical exam), `SU` (substance use) — see `02_sdtm_spec/coverage.json`.

| Domain | Rows | Notes |
|--------|------|-------|
| DM | 40 | one per subject; `ARM/ACTARM`, `RFSTDTC/RFXSTDTC` from first/last dose |
| VS | 720 | SBP/DBP/Pulse/Temp + screening Height/Weight × 4 visits |
| LB | 2080 | chem/hematology/urinalysis incl. MMTT glucose/insulin/C-peptide, HbA1c, cortisol, U-Na/U-K |
| EX | 80 | two crossover treatment periods per subject (placebo `EXDOSE=0`) |
| CM | 54 | metformin (all) + add-ons |
| AE | 32 | CT-coded severity/outcome; no end date for unresolved AEs |
| DS | 40 | disposition (completed / discontinued) |
| MH | 83 | T2DM (all) + comorbidities |

## Traceability

`NCT04556760 → protocol SoA activity → USDM Activity → (NCIt biomedical concept) → SDTM Dataset
Specialization → SDTM variable → synthetic value`.

- Per-cell sample: `03_synthetic_sdtm/lineage.json` (kept out of the CSVs so the SDTM stays clean
  for CORE).
- Per-domain provenance (source activities + protocol page): `02_sdtm_spec/sdtm_spec.json`.
- Standards/versions + content hashes of every artifact: `manifest.json`.

## Stage 6b — CORE conformance validation (CDISC Rules Engine)

The cloned **CDISC Rules Engine** validates the generated SDTM against published SDTMIG 3.4 rules,
**offline** against its bundled cache. The engine consumes SAS V5 XPT / Dataset-JSON / XLSX (CSV
input was dropped after engine 0.16.0), so `06_export_sdtm.py` writes XPT v5 first.

Latest run (engine **0.14.2**, SDTMIG V3.4, CT `sdtmct-2026-03-27`):

| Rules SUCCESS / SKIPPED | Rule-findings | Records flagged | Genuine data bugs |
|--|--|--|--|
| **177 / 257** | 12 | 133 | **0** |

All 12 findings are `tabulation_gap` (e.g. MedDRA-coded `AEDECOD` absent, `MHCAT` granularity,
strict IG variable order) — **no data-quality issues**; categorized in `summary.json`. The two
genuine synthetic-data bugs CORE caught earlier (placebo `EXDOSE≠0`; `AEENDTC` on unresolved AEs)
remain fixed at the source.

> The synthetic SDTM here is **byte-identical** to the previously CORE-validated output the earlier
> CDASH→SDTM path produced — proving the SDTM-first refactor introduced zero data regression. The
> absolute rule counts differ slightly from the older 0.16.0 baseline (170 SUCCESS) only because a
> different engine version is installed locally.

## Caveats (honest scope)

- The SDTM variable specs follow the SDTMIG 3.4 structure and the CT is **real & pinned**; the
  patient *values* are synthetic and **not** statistically modelled on real data.
- USDM is a **v3.0-structured representation** (faithful class names/relationships), not yet
  validated through the `usdm` package / CORE USDM rules — that is the documented next step.
- The offline SDTM spec uses the SDTMIG 3.4 template; live SDTM Dataset Specialization resolution
  via `cdisclib` is wired but requires `CDISC_API_KEY`.
