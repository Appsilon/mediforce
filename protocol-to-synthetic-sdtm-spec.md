# Protocol-to-Synthetic-SDTM Pipeline — Technical Specification

**Status:** v0.2 — design (§1–§13) + as-built record (§0). Updated 2026-06-08.
**Owner:** Vedha / Appsilon
**Target:** CDISC AI Innovation Challenge 2026 — Use Case 1 (AI-enabled Synthetic Data Generation for Automation Testing)
**Implementation tool:** Claude Code

---

## 0. Implementation status (as-built — source of truth)

> v0.1 (§1–§13 below) is the **design**. This section records what has actually been built and
> every deviation from that design. **Where §0 and §1–§13 disagree, §0 wins.**

### 0.1 Delivered components

| Component | Location | What it is | Status |
|-----------|----------|-----------|--------|
| `ctgov` MCP server | `mcp/ctgov/` | FastMCP/stdio wrapper over ClinicalTrials.gov API v2 (Stage-1 input). | Built; offline + live tests pass. |
| `cdisclib` MCP server | `mcp/cdisclib/` | FastMCP/stdio wrapper over the CDISC Library API — Biomedical Concepts, SDTM Dataset Specializations, Controlled Terminology, search. Auth via `CDISC_API_KEY`. | Built; offline + live tests pass. |
| CDISC Library Postman collection | `mcp/cdisclib/cdisc-library.postman_collection.json` (+ production/mock environments) | All 127 GET endpoints across CDISC's four OpenAPI specs (core + COSMoS v1/v2) for manual API exploration. | Built. |
| CORE integration | `cdisc-rules-engine/` (cloned) driven from `test/06`–`test/07` | CDISC Rules Engine wired in for conformance validation; runs offline against its bundled rules cache. | Built; run. |
| Reference end-to-end run | `test/` | Full pipeline on one real trial (NCT04556760): Stage 1 → USDM → CDASH → SDTM → CORE. | Complete. |
| Tooling index | `CUSTOMAGENTS.md` | Running index of MCP servers / skills, with setup + usage. | Maintained. |

### 0.2 Key decisions & findings since v0.1

1. **MCP-first tooling.** Retrieval-heavy external sources are exposed as MCP servers (`ctgov`, `cdisclib`) rather than inline clients, so every stage — and Claude Code itself — can call them. The `clients/` modules in §9 are realized this way for those sources.
2. **A CDASH collection path was implemented first.** The §2 MVP was SDTM-only (CDASH was stretch in §2.2). The reference run instead produces populated **CDASH** datasets (CDASHIG 2.3), because CDASH is the data-*collection* answer to "what datasets are needed," and it tabulates cleanly to SDTM. Each CDASH field records its SDTM mapping target for that tabulation.
3. **CORE has no CDASH conformance rules** — verified against the Library `/mdr/rules` catalog and `core.py list-rule-sets`: rules exist only for `sdtmig`, `sendig`, `adamig`, `tig`, `usdm`. Therefore **CDASH output is validated by tabulating it to SDTMIG 3.4 and running CORE on the SDTM** (CORE's core competency, fully offline). `usdm 3-0/4-0` rules exist for a future Stage-2 gate.
4. **Validate → fix loop proven.** CORE caught two genuine synthetic-data bugs (placebo `EXDOSE≠0`; `AEENDTC` populated for unresolved AEs); both fixed at source and re-validated. Records flagged dropped **3,227 → 154**; genuine data bugs **2 → 0**; SUCCESS rules 153 → 170.
5. **Protocol-PDF SoA extraction was exercised, not deferred.** The run reads the protocol PDF Schedule of Activities (pp.20–24) to build the USDM visit grid + activity list (§2.2 listed this as stretch).

### 0.3 Pinned standards & versions (reference run)

| Item | Value |
|------|-------|
| Input record | ClinicalTrials.gov API v2 (`dataTimestamp` captured per run) |
| USDM | v3.0 (representation; not yet CORE-validated) |
| CDASH | CDASHIG **2.3** |
| SDTM (tabulation target / CORE) | SDTMIG **3.4** |
| Controlled Terminology | **sdtmct-2026-03-27** (pinned) |
| CORE engine | **0.16.0** (bundled cache, offline) |
| Reference trial | **NCT04556760** — AZD9567, AstraZeneca Phase 2a randomised double-blind crossover, T2DM |
| Subjects / random seed | 40 / 1234 |

### 0.4 As-built steps ↔ design stages

| As-built step (script in `test/`) | Output | Design stage (§5) |
|-----------------------------------|--------|-------------------|
| `ctgov` MCP + CDN PDF download | `00_raw/` (study JSON + protocol PDF) | Stage 1 Fetch |
| `01_build_usdm.py` | `01_usdm/usdm.json`, `soa.json` | Stage 2 USDM (+ SoA extraction) |
| `02_build_cdash_spec.py` (uses `cdisclib`) | `02_cdash_spec/` (CDASH spec, CT cache, coverage) | Stage 3+4 (CDASH variant) |
| `03_generate_synthetic_cdash.py` | `03_synthetic_cdash/*.csv` (+ lineage) | Stage 5 Populate |
| `04_validate.py` | `03_synthetic_cdash/validation_report.json` | Stage 6 (CT/VLM/key checks) |
| `06_cdash_to_sdtm.py` | `06_sdtm/datasets/` (SDTMIG 3.4 + CORE input metadata) | **new** — CDASH→SDTM tabulation |
| `07_core_report/run_core_validation.sh` + `07_core_summary.py` | `07_core_report/` (raw JSON, XLSX, digest) | Stage 6 (CORE conformance) |
| `05_write_manifest.py` | `manifest.json` (versions + content hashes) | manifest |

Per-component docs: `mcp/ctgov/README.md`, `mcp/cdisclib/README.md`, `test/README.md`, `CUSTOMAGENTS.md`.

---

## 1. Purpose

Given a single ClinicalTrials.gov registration (`NCT` id), produce **populated synthetic SDTM datasets** plus their **CDASH/SDTM specifications**, with an **end-to-end traceability graph** linking every generated cell back to its source:

```
NCT id → study record → USDM element → Biomedical Concept → SDTM Dataset Specialization → SDTM variable → synthetic value
```

The challenge does not reward "plausible patient data" in the abstract — it rewards *traceable linkage to source inputs and metadata*. Standards Integration / Traceability / Impact is 40% of the score. The traceability graph is therefore a first-class deliverable, not a by-product.

### 1.1 Design principle: deterministic-first

AI is confined to two **semantic** steps (free text → structured objects, and concept matching). Everything structural, enumerable, or verifiable is deterministic code. This maximises reproducibility and validation (the rubric's "Technical Quality" bonus) and keeps the lineage graph auditable.

| Stage | Type |
|-------|------|
| 1. Fetch study record | Deterministic |
| 2. Extract to USDM | **AI (bounded)** |
| 3. Match activities to Biomedical Concepts | **AI (bounded)** |
| 4. Resolve SDTM specs (domains, variables, VLM) | Deterministic |
| 5. Populate datasets | Deterministic |
| 6. Validate + build lineage | Deterministic |

---

## 2. Scope

### 2.1 In scope (MVP — build this first)
- Input path: **registry record only** (no protocol PDF).
- Thin USDM v3.0 study representation built from the CT.gov structured record.
- BC matching for a **fixed MVP domain set**: `DM`, `VS`, `LB`, `AE`, `CM`, `EX`.
- Trial-design domains generated deterministically from USDM (`TA`, `TE`, `TS`, `TV`, `SE`, `SV` as feasible).
- SDTM spec resolution via CDISC Library Dataset Specializations.
- Synthetic value population constrained by Controlled Terminology + Value-Level Metadata.
- CORE conformance validation (USDM input + SDTM output).
- Traceability graph emitted as JSON + a rendered HTML/Graphviz view.
- CLI: `pipeline run --nct <id> --out <dir>`.

### 2.2 Stretch (after MVP works end-to-end)
- Protocol-PDF Schedule of Activities (SoA) extraction → richer USDM + more domains.
- ADaM derivation (`ADSL`, `ADAE`, `ADVS`, `ADLB`) via `admiral`.
- CDASH form specs alongside SDTM.
- Define-XML 2.1 and Dataset-JSON output.

### 2.3 Out of scope
- Real patient-level data, EHR, or RWD ingestion.
- Statistical-fidelity modelling (learning distributions from real data).
- Multi-study / batch orchestration.
- Any claim of production-grade USDM conformance beyond "USDM v3.0-conformant representation."

---

## 3. Architecture

The pipeline is a sequence of **pure transformations over typed artifacts**. Each stage reads one or more artifacts from a run directory and writes new artifacts to it. Stages are **idempotent and resumable**: re-running a stage overwrites only its own outputs, so a failed Stage 4 can be retried without re-running the AI stages.

```
runs/<nct>-<timestamp>/
  00_raw_study.json          (Stage 1)
  01_usdm.json               (Stage 2)  + 01_usdm.review.json (HITL)
  02_bc_matches.json         (Stage 3)  + 02_bc_matches.review.json (HITL)
  03_sdtm_specs.json         (Stage 4)
  04_datasets/               (Stage 5)  *.csv and/or *.json per domain
  05_lineage.json            (Stage 6)
  05_validation_report.json  (Stage 6)
  05_lineage.html            (Stage 6)  rendered graph
  run.log
  manifest.json              (versions, params, hashes for every artifact)
```

`manifest.json` pins all standard versions (USDM, SDTMIG, CT package date), the LLM model id, the input NCT id, and a content hash of each artifact — this *is* part of the reproducibility story for judges.

---

## 4. Tech stack

**Primary language: Python.** Keep the whole pipeline in one runtime for cohesion; only reach for R if `sdtm.oak`/`admiral` derivations are needed in the stretch phase.

| Concern | Library / resource | Notes |
|---------|-------------------|-------|
| CT.gov fetch | `requests` / `pytrials` | API v2, `https://clinicaltrials.gov/api/v2/studies/{nctId}?format=json` |
| USDM model + validate | `cdisc-org/usdm` (PyPI `usdm`) | Requires `CDISC_API_KEY`; pin USDM v3.0 |
| USDM/SDTM conformance | `cdisc-org/cdisc-rules-engine` (CORE) | Validates USDM JSON Schema (v3.0/v4.0) and SDTM |
| Biomedical Concepts + Dataset Specializations | CDISC Library API (`/cosmos/v2/...`, `/sdtm/datasetspecializations`) | Reference: `cdisc-org/COSMoS`; optional wrapper `cdisc-library-mcp-server` |
| Controlled Terminology | CDISC Library CT endpoints | Pin a CT package date in `manifest.json` |
| Structural synthetic backbone | `random.cdisc.data` (R) *or* native sampling | MVP uses native Python sampling under VLM constraints |
| SDTM derivation (stretch) | `pharmaverse/sdtm.oak` | Metadata-driven; pairs with Dataset Specializations |
| ADaM (stretch) | `pharmaverse/admiral` | SDTM → ADaM |
| LLM (Stages 2–3) | Anthropic API (configurable) | Must support structured/JSON output + tool use |
| Lineage graph | `networkx` + `graphviz` | JSON model + rendered HTML/SVG |

### 4.1 Configuration
All via env vars / a `config.yaml`:
- `CDISC_API_KEY` (required — cdiscID; used by the `cdisclib` MCP and `core.py update-cache`)
- `ANTHROPIC_API_KEY` (or chosen provider)
- `USDM_VERSION` (default `3.0`)
- `CDASHIG_VERSION` (default `2.3` — as-built; CDASH is the collection path, §0.2.2)
- `SDTMIG_VERSION` (default `3.4` — tabulation target + CORE standard)
- `CT_PACKAGE_DATE` (as-built pinned: `sdtmct-2026-03-27`)
- `LLM_MODEL` (default a current Claude model id)
- `MVP_DOMAINS` — as-built CDASH set: `[DM, IE, MH, VS, EG, LB, EX, CM, AE, DS]` (populated); `[PC, PE, SU]` resolved-but-deferred. Original SDTM MVP set was `[DM, VS, LB, AE, CM, EX]`.
- `SUBJECT_COUNT` (default 50; reference run used **40** to mirror the trial's completed cohorts 24/8/8)
- `RANDOM_SEED` (default 1234 — reproducibility)

---

## 5. Stage specifications

Each stage is a module exposing `run(run_dir: Path, config: Config) -> Artifact`. Stages declare their input artifacts and fail fast if a prerequisite is missing.

### Stage 1 — Fetch study record  *(deterministic)*
- **Input:** `nct_id`, config.
- **Action:** `GET /api/v2/studies/{nctId}?format=json`. Persist verbatim. Capture `/api/v2/version` `dataTimestamp` into the manifest. (Stretch: discover and download protocol PDF from `cdn.clinicaltrials.gov/large-docs/...` if present.)
- **Output:** `00_raw_study.json`.
- **Failure modes:** unknown NCT (404) → hard fail with clear message; rate limiting → backoff + retry.
- **HITL:** none.

### Stage 2 — Extract to USDM  *(AI, bounded)*
- **Input:** `00_raw_study.json`.
- **Action:** Deterministically map the structured, enumerated fields (arms, interventions, eligibility flags, phase, design) into USDM objects. Use the **LLM only** to structure the free-text fragments that have no clean schema field: parse eligibility criteria into discrete criterion objects, normalise objectives/endpoints, and (registry path) infer a minimal activity list from outcome measures. The LLM returns JSON conforming to a fixed schema; the `usdm` package then assembles and validates the USDM document.
- **Output:** `01_usdm.json` (must pass USDM v3.0 schema via CORE).
- **Failure modes:** LLM output fails schema → retry with the validation error appended (max N retries) → escalate to HITL.
- **HITL checkpoint:** emit `01_usdm.review.json` summarising what was inferred vs. directly mapped; pipeline can pause for human approval before continuing.

### Stage 3 — Match activities to Biomedical Concepts  *(AI, bounded)*
- **Input:** `01_usdm.json` (activities / assessments), CDISC Library BC catalogue.
- **Action:** For each USDM activity/assessment, retrieve candidate BCs (deterministic search against the Library by keyword/NCIt where possible), then use the **LLM to select the best-matching BC** from the candidate set and assign a confidence score. The LLM never invents a BC id — it only chooses from retrieved candidates (constrained generation). Unmatched activities are flagged, not dropped.
- **Output:** `02_bc_matches.json` — list of `{activity_id, bc_id, bc_label, confidence, candidates[]}`.
- **Failure modes:** no candidate BC → flag activity as `unmatched` and exclude its domain (logged).
- **HITL checkpoint:** `02_bc_matches.review.json` lists every match with confidence; low-confidence matches surfaced for human confirmation.

### Stage 4 — Resolve SDTM specs  *(deterministic)*
- **Input:** `02_bc_matches.json`.
- **Action:** For each matched BC, fetch its **SDTM Dataset Specialization(s)** from the CDISC Library. Union the implied domains with the MVP domain set; generate trial-design domains directly from USDM. For each domain, assemble the variable-level spec from the Dataset Specialization `variables[]`: `name, role, dataType, length, codelist/subsetCodelist, valueList, assignedTerm, mandatoryVariable, mandatoryValue, originType, vlmTarget`. This is the CDASH/SDTM "datasets needed" answer **and** the constraint set for Stage 5.
- **Output:** `03_sdtm_specs.json` — per domain: ordered variable list + VLM + provenance pointer back to BC and USDM element.
- **Failure modes:** Library miss for a domain → fall back to SDTMIG v3.4 domain template (logged as `template_fallback`).
- **HITL:** none (deterministic, but spec is reviewable).

### Stage 5 — Populate datasets  *(deterministic)*
- **Input:** `03_sdtm_specs.json`, `SUBJECT_COUNT`, `RANDOM_SEED`.
- **Action:** Generate `SUBJECT_COUNT` subjects in `DM`; for each subject, populate records per domain by sampling values **within the VLM constraints**: controlled-terminology variables sample from the codelist; numeric variables sample within plausible ranges (seeded); mandatory variables/values always populated; `--SEQ`, `STUDYID`, `USUBJID`, `DOMAIN`, and standard identifiers assigned deterministically; date variables generated against the USDM epoch/visit structure where available. Every populated cell records a provenance pointer (domain, variable, source BC, source USDM element). Use `random.cdisc.data` to seed structurally-correct skeletons if helpful, then overlay constrained values.
- **Output:** `04_datasets/<DOMAIN>.csv` and/or `.json` per domain.
- **Failure modes:** codelist fetch failure → fail the domain, not the run (logged).
- **HITL:** none.

### Stage 6 — Validate + build lineage  *(deterministic)*
- **Input:** all prior artifacts.
- **Action:** (a) Run CORE SDTM conformance against the generated datasets; (b) run VLM constraint checks (mandatory present, CT membership, type/length); (c) assemble the lineage graph (see §7) and render it; (d) write a validation report with pass/fail per rule and per domain.
- **Output:** `05_validation_report.json`, `05_lineage.json`, `05_lineage.html`.
- **Failure modes:** conformance failures are reported, not fatal — the report *is* a deliverable.
- **HITL:** final human review of report + lineage.

---

## 6. Data contracts

Stages communicate only through artifacts on disk. Shapes below are normative.

### 6.1 `02_bc_matches.json`
```json
{
  "study_id": "NCT01234567",
  "matches": [
    {
      "activity_id": "act_vital_signs",
      "activity_label": "Vital signs",
      "bc_id": "C49680",
      "bc_label": "Systolic Blood Pressure",
      "confidence": 0.93,
      "method": "llm_select_from_candidates",
      "candidates": ["C49680", "C25298", "..."],
      "status": "matched"
    }
  ],
  "unmatched": ["act_some_activity"]
}
```

### 6.2 `03_sdtm_specs.json` (per-domain entry)
```json
{
  "domain": "VS",
  "source_bc_ids": ["C49680", "C25298"],
  "source_usdm_activity_ids": ["act_vital_signs"],
  "dataset_specialization_ids": ["VSBP", "VSHR"],
  "variables": [
    {
      "name": "VSTESTCD",
      "role": "Topic",
      "dataType": "text",
      "codelist": "C66741",
      "mandatoryVariable": true,
      "mandatoryValue": true,
      "originType": "Assigned",
      "provenance": {"bc_id": "C49680", "usdm_activity_id": "act_vital_signs"}
    }
  ]
}
```

### 6.3 Provenance record (attached to every populated cell)
```json
{
  "usubjid": "NCT01234567-0001",
  "domain": "VS",
  "variable": "VSORRES",
  "value": "120",
  "lineage": {
    "nct_id": "NCT01234567",
    "usdm_activity_id": "act_vital_signs",
    "bc_id": "C49680",
    "dataset_specialization_id": "VSBP",
    "codelist": null,
    "constraint": "numeric range [80,180]"
  }
}
```

---

## 7. Traceability model (the scoring linchpin)

A directed graph (`networkx`), serialised to `05_lineage.json` and rendered to HTML.

**Node types:** `Study(NCT)`, `USDMElement` (objective/endpoint/activity/eligibility), `BiomedicalConcept`, `DatasetSpecialization`, `SDTMVariable`, `SyntheticCell` (sampled to a representative subset for rendering).

**Edge types:** `registered_as`, `inferred_to` (AI, carries confidence), `specialized_as`, `defines_variable`, `populated_as`.

The rendered view must let a judge click any synthetic value and walk back to the originating NCT field. The AI-inferred edges are visually distinguished (e.g. dashed + confidence label) so the deterministic vs. inferred boundary is explicit — this honesty is itself a credibility signal.

---

## 8. AI agent design (Stages 2 & 3)

Both AI stages follow the same contract to stay bounded and auditable:

1. **Constrained output.** The model returns JSON against a fixed schema (no prose). Stage 2 → USDM-fragment schema; Stage 3 → a *selection* from a retrieved candidate set (the model picks an id, it does not generate one).
2. **Validation gate.** Output is validated immediately (USDM schema in Stage 2; candidate-membership check in Stage 3). On failure, retry with the error appended, up to `LLM_MAX_RETRIES`, then escalate to HITL.
3. **No hidden state.** Each call is stateless; all context is passed explicitly so runs are reproducible given the same inputs + model id (recorded in manifest).
4. **HITL checkpoints.** Each AI stage emits a `*.review.json` and supports a `--pause-after <stage>` flag so a human can approve before the deterministic stages consume AI output.

Prompts live in `prompts/` as versioned files, referenced by hash in the manifest.

---

## 9. Repository structure

### 9.1 As-built (current)

```
ct_to_synthetic_data/
  protocol-to-synthetic-sdtm-spec.md   # THIS spec — single source of truth
  CUSTOMAGENTS.md                       # index of MCP servers / skills
  mcp/
    ctgov/                              # MCP: ClinicalTrials.gov API v2 (Stage 1)
      src/ctgov_mcp/{server,client,cache}.py
      tests/{test_client,test_tools,test_live_smoke}.py + fixtures/
      README.md, pyproject.toml, .venv/
    cdisclib/                           # MCP: CDISC Library API (BC, Dataset Spec, CT, search)
      src/cdisclib_mcp/{server,client,cache}.py
      tests/... + fixtures/
      tools/build_postman_collection.py
      cdisc-library.postman_collection.json
      cdisc-library.{production,mock}.postman_environment.json   # production gitignored (holds key)
      README.md, pyproject.toml, .venv/
  cdisc-rules-engine/                   # cloned CDISC Rules Engine (CORE), offline cache; .venv/
  test/                                 # reference end-to-end run (NCT04556760) — see test/README.md
    00_raw/            01_build_usdm.py          01_usdm/
    02_build_cdash_spec.py   02_cdash_spec/      03_generate_synthetic_cdash.py   03_synthetic_cdash/
    04_validate.py     05_write_manifest.py      06_cdash_to_sdtm.py              06_sdtm/datasets/
    07_core_summary.py 07_core_report/           protocol/   manifest.json   README.md
  .mcp.json                             # registers ctgov + cdisclib for Claude Code
```

`.venv/` and the production Postman environment (contains `CDISC_API_KEY`) are gitignored.

### 9.2 Planned productization target (`p2s` package)

The reference run in `test/` is a sequence of numbered scripts proving the pipeline end-to-end.
The intended next step is to refactor it into an installable package with a CLI — stages as pure
`run(run_dir, config)` transforms, the MCP servers reused as the CT.gov/Library clients, and a
`runs/<nct>-<ts>/` output convention (§3):

```
src/p2s/{cli.py, config.py, artifacts.py}
src/p2s/stages/{s1_fetch, s2_extract_usdm, s3_match_bc, s4_resolve_specs, s5_populate, s6_validate_lineage}.py
src/p2s/clients/{ctgov, cdisc_library, core_engine, llm}.py     # ctgov/cdisc_library via the MCP servers
src/p2s/lineage/{graph, render}.py
prompts/{s2_extract_usdm, s3_match_bc}.md
runs/                                                            # gitignored
```

---

## 10. Validation strategy

- **USDM (Stage 2):** CORE JSON Schema validation against the pinned USDM version. Hard gate.
- **SDTM (Stage 6):** CORE conformance rules against generated datasets. Reported, non-fatal.
- **VLM (Stage 6):** mandatory-present, CT-membership, datatype/length, key uniqueness (`USUBJID`+`--SEQ`). Reported.
- **Tests:** every stage has unit tests against recorded fixtures so the full pipeline runs offline in CI; one small real NCT id is used for a manual smoke test.

### 10.1 As-built CORE validation

- **No CDASH rules exist** (Library `/mdr/rules`; CORE `list-rule-sets`). Published conformance
  rule packages: `sdtmig`, `sendig`, `adamig`, `tig`, `usdm`. So the CDASH output is **tabulated
  to SDTMIG 3.4** (`test/06_cdash_to_sdtm.py`, using each field's recorded SDTM mapping target)
  and CORE is run on the SDTM. CORE runs **offline** against its bundled cache.
- **Light checks first** (`test/04_validate.py`): CT membership, mandatory identifiers, key
  uniqueness, provenance completeness on the CDASH CSVs — all pass.
- **CORE run** (`-s sdtmig -v 3-4 -ct sdtmct-2026-03-27`): after the validate→fix loop (§0.2.4),
  170 SUCCESS / 7 ISSUE / 251 SKIPPED / 2 EXECUTION-ERROR rules; 154 records flagged, **0 genuine
  data-quality issues**. Remaining items are tabulation gaps (e.g. MedDRA-coded `AEDECOD` absent,
  strict IG variable order) and two rules that need a Define-XML to execute. Reports + categorized
  digest in `test/07_core_report/`.
- **USDM gate (planned):** CORE ships `usdm 3-0/4-0` rules; wiring Stage-2 to emit the official
  DDF USDM wrapper JSON and validating it is the next gate to add.

---

## 11. Build order (milestones)

1. **M1 — Skeleton + Stage 1 + manifest/artifacts.** Fetch and persist a study; run dir + manifest working.
2. **M2 — Stage 4 + Stage 5 against a hand-written BC-match fixture.** Prove the deterministic spine end-to-end (specs → populated datasets) *before* wiring AI.
3. **M3 — Stage 6 validation + lineage.** Get CORE + lineage rendering on M2 output.
4. **M4 — Stage 3 (BC matching).** Replace the fixture with real Library retrieval + LLM selection.
5. **M5 — Stage 2 (USDM extraction).** Replace the hand-built USDM with the AI-assisted build.
6. **M6 — Polish demo + 6-min recording** (registry path, single NCT, full lineage walk-through).
7. **Stretch — protocol PDF, ADaM, Define-XML.**

> Rationale: building the deterministic spine first (M2–M3) means you always have a runnable, demoable pipeline; the AI stages slot in as upgrades rather than blockers.

---

## 12. Open decisions

- **Registry-only vs. registry+PDF for MVP.** Default: registry-only. PDF/SoA is the single biggest realism upgrade but adds the hardest extraction problem — defer to stretch.
- **USDM v3.0 vs v4.0.** Default v3.0 (stable conformance rules since Dec 2024); revisit if v4 buys needed structure.
- **MVP domain set.** Default `DM, VS, LB, AE, CM, EX`. Confirm which domains the chosen demo NCT actually implies.
- **LLM provider/model.** Provider-agnostic client; pick the default model at build time.
- **CSV vs Dataset-JSON output.** Default both; Dataset-JSON strengthens the standards-integration score.

---

## 13. References

- ClinicalTrials.gov API v2 — `clinicaltrials.gov/data-api/api`
- CDISC USDM / DDF — `cdisc.org/ddf`; `github.com/cdisc-org/usdm`; `github.com/cdisc-org/DDF-RA`
- Biomedical Concepts / COSMoS — `cdisc.org/cdisc-biomedical-concepts`; `github.com/cdisc-org/COSMoS`
- CDISC Library API — `cdisc.org/cdisc-library` (cdiscID required)
- CORE / rules engine — `cdisc.org/standards/foundational/core`; `github.com/cdisc-org/cdisc-rules-engine`
- pharmaverse — `pharmaverse/sdtm.oak`, `pharmaverse/admiral`, `insightsengineering/random.cdisc.data`
- "Modernization of Clinical Data Flow Leveraging CDISC 360i" (ACDM, Jan 2026) — protocol → BC → SDTM reference flow
