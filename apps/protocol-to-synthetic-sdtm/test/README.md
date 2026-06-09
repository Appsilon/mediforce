# Test run — Protocol → USDM → CDASH → Synthetic CDASH

End-to-end MVP demonstration of the pipeline on one real trial, using the **ctgov** and
**cdisclib** MCPs/clients. Pick a registered trial that has a protocol PDF, represent it in
**USDM v3.0**, resolve the **CDASH** datasets it implies, and generate **populated synthetic
CDASH datasets** — with traceability from every synthetic cell back to the source protocol.

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
python3 01_build_usdm.py            # Stage 2: CT.gov record + protocol SoA -> USDM v3.0
CDISC_API_KEY=<key> ../mcp/cdisclib/.venv/bin/python 02_build_cdash_spec.py   # Stage 3/4: CDASH spec from CDISC Library
python3 03_generate_synthetic_cdash.py   # Stage 5: populate synthetic CDASH (seed 1234)
python3 04_validate.py              # Stage 6: validate (CT membership, keys, provenance)
python3 05_write_manifest.py        # manifest with versions + content hashes
```

## Steps & artifacts

| Stage | What happened | Tool | Output |
|-------|---------------|------|--------|
| **1. Fetch** | Pulled the verbatim CT.gov v2 record and downloaded the protocol PDF (CT.gov CDN). Captured API `dataTimestamp` for provenance. | **ctgov MCP** (`get_study`, `search_studies`, `get_api_version`) + CDN | `00_raw/NCT04556760.json`, `protocol/Prot_000.pdf` |
| **2. USDM** | Mapped enumerated registry fields (phase, design, arms, interventions, eligibility, objectives/endpoints) deterministically; **read the protocol Schedule of Activities (pp.20–24)** to extract the visit grid + activity list. Assembled a USDM v3.0-structured study (DDF class names: StudyVersion, StudyDesign, Epoch, Encounter, Activity, ScheduleTimeline/ScheduledActivityInstance, StudyIntervention, EligibilityCriterion, Objective/Endpoint). | reading + deterministic build | `01_usdm/usdm.json`, `01_usdm/soa.json` |
| **3+4. CDASH spec** | For each CDASH domain the USDM activities imply, pulled **CDASHIG 2.3** field lists from the CDISC Library, plus each coded field's **Controlled Terminology** (pinned `sdtmct-2026-03-27`) and its **SDTM mapping target** (CDASH→SDTM traceability). Attached USDM-activity + protocol-page provenance to each domain. | **cdisclib client** (CDISC Library API) | `02_cdash_spec/cdash_spec.json`, `ct_cache.json`, `coverage.json` |
| **5. Populate** | Generated **40 subjects** across the 3 cohorts (24/8/8) with AB/BA crossover sequences. Coded values sampled from the fetched CT; numeric results sampled within plausible clinical ranges; identifiers + `--SEQ` assigned deterministically (seed 1234). Every findings/intervention row carries `SRCACT` (USDM activity) + `SRCPAGE` (protocol page). | deterministic, seeded | `03_synthetic_cdash/*.csv`, `lineage.json`, `datasets_summary.json` |
| **6. Validate** | Checked mandatory identifiers, key uniqueness (`STUDYID+SUBJID+--SEQ`), CT membership of coded fields, and provenance completeness. | deterministic | `03_synthetic_cdash/validation_report.json` |

## CDASH datasets produced (CDASHIG 2.3)

Implied by the USDM activities: `DM, IE, MH, VS, EG, LB, EX, CM, AE, DS, PC, PE, SU`.
**Populated** (10): `DM, IE, MH, VS, EG, LB, EX, CM, AE, DS` — **3,793 rows total**.
**Deferred** (spec resolvable, not populated this run): `PC` (PK concentrations), `PE` (physical
exam), `SU` (substance use) — see `02_cdash_spec/coverage.json`.

| Domain | Rows | Notes |
|--------|------|-------|
| DM | 40 | one per subject |
| IE | 2 | inclusion/exclusion exceptions (criteria-not-met model) |
| MH | 83 | T2DM (all) + comorbidities |
| VS | 720 | SBP/DBP/Pulse/Temp + screening Height/Weight × 4 visits |
| EG | 640 | QTcF/HR/PR/QRS × 4 visits |
| LB | 2080 | chem/hematology/urinalysis panel incl. MMTT glucose/insulin/C-peptide, HbA1c, cortisol, U-Na/U-K |
| EX | 80 | two crossover treatment periods per subject |
| CM | 54 | metformin (all) + add-ons |
| AE | 54 | ~55% of subjects, CT-coded severity/outcome |
| DS | 40 | disposition (completed / discontinued) |

## Traceability

`NCT04556760 → protocol SoA activity → USDM Activity → (NCIt biomedical concept) → CDASH domain
field (+ SDTM target) → synthetic value`.

- Per-row: `SRCACT` + `SRCPAGE` columns in every findings/intervention CSV.
- Per-cell sample: `03_synthetic_cdash/lineage.json`.
- Standards/versions + content hashes of every artifact: `manifest.json`.

## Stage 6b — CORE conformance validation (CDISC Rules Engine)

The cloned **CDISC Rules Engine** (`../cdisc-rules-engine`) validates our model output against
published conformance rules. Key fact established here: **CORE has no CDASH rule catalog** — the
CDISC Library publishes conformance rules only for `sdtmig`, `sendig`, `adamig`, `tig`, and
`usdm` (verified against `/mdr/rules` and `core.py list-rule-sets`). CDASH is a *collection*
standard with no CORE rules. So we **tabulate the synthetic CDASH → SDTMIG 3.4** (using the
`sdtmTarget` mappings captured in Stage 4) and validate that, which is CORE's core competency and
runs fully offline against the engine's bundled cache.

```bash
python3 06_cdash_to_sdtm.py            # CDASH -> SDTMIG 3.4 (06_sdtm/datasets/*.csv + _datasets/_variables.csv)
./07_core_report/run_core_validation.sh   # CORE validate -s sdtmig -v 3-4 -ct sdtmct-2026-03-27
python3 07_core_summary.py             # categorized digest -> 07_core_report/summary.json
```

**The validate → fix loop (this is the point):** CORE found two genuine bugs in the synthetic
generator, which we fixed at the source and re-validated:

| | First run | After fixes |
|--|-----------|-------------|
| Rules SUCCESS / ISSUE / SKIPPED / ERROR | 153 / 13 / 260 / 4 | **170 / 7 / 251 / 2** |
| Rule-findings | 54 | **31** |
| Records flagged | 3,227 | **154** |
| Genuine data bugs | **2** | **0** |

Bugs CORE caught and we fixed:
- `CORE-000005` — EX `EXTRT=PLACEBO` but `EXDOSE≠0` (placebo dose now collected as 0).
- `CORE-000657` — `AEENDTC` populated when `AEOUT=NOT RECOVERED/NOT RESOLVED` (ongoing AEs now have no end date).

We also added SDTM derivations the first run flagged (`EPOCH`, study-day `--DY`, `RFXSTDTC/RFXENDTC`,
variable ordering), which removed ~3,000 flagged records. The remaining 154 are categorized in
`summary.json` as `tabulation_gap` (e.g. MedDRA-coded `AEDECOD` not present, MHCAT granularity,
strict IG variable order) or `harness` (two rules error without a Define-XML) — **no remaining
data-quality issues**.

Outputs: `07_core_report/core_sdtmig34.json` (raw), `core_sdtmig34.xlsx` (human-readable),
`summary.json` (categorized digest), `run_core_validation.sh` (reproducible command).

## Caveats (honest scope)

- The CDASH field specs are **real** (CDISC Library CDASHIG 2.3) and CT is **real & pinned**; the
  patient *values* are synthetic and **not** statistically modelled on real data.
- USDM is a **v3.0-structured representation** (faithful class names/relationships), not validated
  through the `usdm` package / CORE engine — that is the documented next step.
- CDASH is the **collection** standard; SDTM tabulation/CORE conformance is out of scope for this
  CDASH-focused run (each field records its `sdtmTarget` so the SDTM step is a clean follow-on).
