# CDISC Rule Categories and Severity

Reference material for classifying CDISC CORE rules engine findings. Use this when the `data-validator` skill builds the domain × category heatmap and assigns severity badges.

## Rule categories

CDISC CORE rules ship under five named buckets. Each bucket has a different remediation owner and a different escalation profile.

### Structure

Rules that check whether the file even parses as a valid CDISC dataset.

- **Examples:** missing required variables, wrong variable types, malformed XPT header, dataset not present.
- **Typical CORE prefixes:** `SD0001`–`SD0099` (SDTM structural), `AD0001`–`AD0099` (ADaM structural).
- **Owner:** CRO programmer / data manager.
- **Escalation profile:** Critical structural findings often mean the rest of the validation is unreliable for that domain. Surface these prominently. A delivery with even one Critical Structure finding usually cannot be ingested as-is.

### Controlled Terminology

Rules that check whether values come from the CDISC controlled-terminology codelists at the IG version specified by the study.

- **Examples:** `SEX = "M"` instead of `"M"` (looks the same but trailing whitespace), unknown values for `RACE`, `LBTESTCD` not in the LBTESTCD codelist.
- **Typical CORE prefixes:** `CT0001`+ (controlled terminology), domain-specific codes like `SD0050`–`SD0099` for terminology checks per SDTM domain.
- **Owner:** CRO programmer; sometimes resolved by a CT version bump rather than a data fix.
- **Escalation profile:** Usually Major or Minor. A pattern of CT violations across many domains can indicate the CRO ran an old codelist version — note this in the summary.

### Consistency

Rules that check internal consistency: cross-variable, cross-record, or cross-domain.

- **Examples:** subject in `AE` not present in `DM`, `AESTDTC > AEENDTC`, `--SEQ` duplicated within `USUBJID`.
- **Typical CORE prefixes:** `CG0001`+ (consistency-general), domain-specific consistency codes embedded in `SD####` ranges.
- **Owner:** CRO data manager — these often need source-data investigation.
- **Escalation profile:** Major findings on safety-critical domains (AE, DM, EX) deserve mention in the summary. Date ordering issues on lab data are common but lower priority.

### FDA Business Rules

Rules layered on top of base SDTM/ADaM that encode FDA-specific submission expectations (eCTD, Technical Rejection Criteria).

- **Examples:** define.xml missing required leaf elements, datasets exceeding FDA size limits, required FDA-specific variables absent.
- **Typical CORE prefixes:** `FDA####` or rules tagged `FDA` in their metadata.
- **Owner:** Sponsor regulatory team; CRO if the violation is in CRO-produced metadata.
- **Escalation profile:** A finding tagged "FDA Technical Rejection Criteria" means the package would be auto-rejected by FDA's gateway. Always surface these.

### PMDA

Rules layered on top of base SDTM/ADaM for PMDA (Japanese regulator) submission expectations.

- **Examples:** PMDA-specific Japanese-language metadata requirements, PMDA-specific dataset structure constraints.
- **Typical CORE prefixes:** `PMDA####` or rules tagged `PMDA`.
- **Owner:** Sponsor regulatory team for Japan submissions.
- **Escalation profile:** Only relevant if the study is targeting PMDA. For US-only submissions these can usually be filtered out — but show them in the heatmap so the reviewer notices if a CRO is shipping a Japan-targeting build by mistake.

### Other / unknown prefix

Findings whose `rule_id` does not start with one of the prefixes above. Place them under "Other" in the heatmap. Do not guess. The reviewer can drill down by reading `/workspace/findings.json` directly.

## Severity levels

CDISC CORE assigns one of four severity levels per rule. The rules engine emits the level on each finding (field name varies — commonly `severity` or `level`). Use it as-is; do not infer severity from category alone.

| Level | Meaning | Submission impact |
|-------|---------|-------------------|
| **Critical** | Rule violation that blocks downstream processing or causes auto-rejection. | Submission cannot proceed without fix. |
| **Major** | Rule violation that meaningfully degrades data quality but does not block processing. | Submission proceeds but reviewer expects a remediation plan. |
| **Minor** | Rule violation with limited impact, often cosmetic or terminology drift. | Often waived with justification. |
| **Warning** | Heuristic / advisory; not a regulatory violation. | Informational. |

When severity is missing on a finding, leave the badge blank in the HTML rather than guessing. The CORE engine occasionally emits findings without an explicit severity for newer rule sets; the reviewer should see the gap.

## Severity colour mapping for the HTML report

Use these Tailwind utility classes when rendering severity badges:

- Critical → `bg-red-600 text-white`
- Major → `bg-amber-500 text-white`
- Minor → `bg-yellow-300 text-black`
- Warning → `bg-slate-300 text-black`
- Unknown / blank → `bg-slate-100 text-slate-500`

## Heatmap colour scale

Counts in the domain × category heatmap should use:

- 0 → empty cell, no background
- 1–4 → `bg-amber-100`
- 5–19 → `bg-amber-300`
- 20+ → `bg-red-400 text-white`

This matches the severity scale above visually but stays distinct from the per-finding badges (no full red except for high counts).

## Mapping rule codes to categories

The rules engine emits `rule_id` (sometimes `core_id`). Strip whitespace and uppercase before matching the prefix:

| Prefix | Category |
|--------|----------|
| `SD####` (numeric range 0001–0049) | Structure (SDTM) |
| `SD####` (numeric range 0050–0099) | Controlled Terminology (per-domain CT checks) |
| `AD####` (numeric range 0001–0099) | Structure (ADaM) |
| `CT####` | Controlled Terminology |
| `CG####` | Consistency |
| `FDA####` | FDA Business Rules |
| `PMDA####` | PMDA |
| anything else | Other |

These ranges are conventions, not guarantees. Some CORE versions ship rules with metadata that names the category explicitly — when present, prefer the explicit metadata field over the prefix heuristic. Always read defensively.
