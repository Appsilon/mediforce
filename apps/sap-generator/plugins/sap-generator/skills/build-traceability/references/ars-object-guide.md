# ARS Object Guide (pragmatic subset)

This guide defines the subset of the CDISC **Analysis Results Standard (ARS)**
object model the `build-traceability` skill emits as `analysis-metadata.json`. It
is not the full normative ARS model — it is the slice needed to make a generated
SAP traceable and machine-checkable, using ARS object names and relationships so
the output is recognizable to ARS practitioners and consumable by the downstream
`protocol-to-tfl` pipeline.

## Why ARS for traceability

ARS provides an auditable chain: a planned **Analysis** declares the statistical
**method** it uses, the **population** (AnalysisSet) and **subset** it runs on,
the **grouping** (e.g. treatment arm) it compares, and the **Display** (table /
figure / listing) it produces — all under one **ReportingEvent**. Capturing the
SAP this way means each result can later be traced back to its data selection,
method, population, and the SAP/protocol element that motivated it.

## Object model (subset)

Object names and relationships follow the real ARS logical model (CDISC, LinkML;
[docs](https://cdisc-org.github.io/analysis-results-standard/)). This is a
pragmatic *subset* — enough for traceability and downstream composition.

| ARS object | What it captures | Maps from study-design.json / SAP |
|---|---|---|
| `ReportingEvent` | Root container for one reporting effort (this SAP) — holds analyses, outputs, reference documents, terminology extensions. | `study_identification.study_id` + SAP title. |
| `AnalysisSet` | A population, defined by a **`whereClause`** condition. | `populations[]` (definition → whereClause). |
| `DataSubset` | A further filter within a set (same where-clause machinery). | endpoint `timing` / analysis filters. |
| `GroupingFactor` → `Group` | A categorical split (e.g. treatment arm, subgroup); analyses reference **ordered** grouping factors. | `study_design.treatment_arms[]`, subgroup analyses. |
| `AnalysisMethod` → `Operation` | A reusable method = an **ordered set of `Operation`s**, each producing one result value. | `analysis_requirements[].method` (or SAP DECISION default). |
| `Analysis` | One planned analysis: references a `method` + `analysisSet` + ordered `groupingFactor`s + optional `dataSubset`; carries `purpose` and `reason`; serves an endpoint. | `analysis_requirements[]`. |
| `Output` → `OutputDisplay` → `DisplaySection` | The TFL the analysis populates, down to section text. | SAP §16 planned-TLG list. |
| `ReferenceDocument` | Link to the SAP / source code / external doc. | the SAP itself + section number. |

## JSON shape to emit

```json
{
  "schema_version": "1.0",
  "ars_subset": true,
  "reportingEvent": {
    "id": "RE-<study_id>",
    "name": "string — SAP title",
    "studyId": "string — study_identification.study_id"
  },
  "analysisSets": [
    {
      "id": "AS-<population_id>",
      "label": "string — population name",
      "whereClause": "string — the population condition (verbatim definition, or a simple predicate)",
      "_population_id": "string — link to study-design populations[].population_id"
    }
  ],
  "dataSubsets": [
    {
      "id": "DS-<short>",
      "label": "string",
      "whereClause": "string — the filter as a condition"
    }
  ],
  "groupingFactors": [
    {
      "id": "GF-TRT",
      "label": "Treatment arm",
      "groups": [
        { "id": "string — arm_id", "label": "string — arm_name" }
      ]
    }
  ],
  "analysisMethods": [
    {
      "id": "AM-<short>",
      "label": "string — e.g., 'Stratified log-rank test'",
      "operations": [
        {
          "id": "Op-<short>",
          "name": "string — e.g., 'p-value', 'hazard ratio', '95% CI lower'",
          "resultPattern": "string — what this operation outputs"
        }
      ],
      "_is_sap_decision": "boolean — true if introduced by the SAP, not the protocol"
    }
  ],
  "analyses": [
    {
      "id": "AN-<requirement_id>",
      "label": "string — e.g., 'Primary analysis of Overall Survival'",
      "purpose": "primary | secondary | sensitivity | subgroup | safety | exploratory",
      "reason": "string — 'SPECIFIED IN SAP' or 'SPECIFIED IN PROTOCOL'",
      "methodId": "AM-<short>",
      "analysisSetId": "AS-<population_id>",
      "dataSubsetIds": ["DS-<short>"],
      "orderedGroupingFactorIds": ["GF-TRT"],
      "adamTarget": "string — ADaM dataset this analysis reads (ADSL | ADTTE | ADRS | ADAE | ADLB | ...)",
      "_endpoint_id": "string — study-design endpoints.<tier>[].endpoint_id (tier = primary|secondary|exploratory|safety)",
      "_analysis_requirement_id": "string — study-design analysis_requirements[].requirement_id",
      "_sap_section": "string — e.g., '8.1'",
      "outputId": "OUT-<short>"
    }
  ],
  "outputs": [
    {
      "id": "OUT-<short>",
      "label": "string — TLG title",
      "displayType": "table | figure | listing",
      "number": "string or null — CSR-aligned number if known",
      "outputDisplay": {
        "sections": ["string — display section labels, e.g. 'Title', 'Body', 'Footnotes'"]
      }
    }
  ],
  "referenceDocuments": [
    {
      "id": "RD-SAP",
      "label": "Statistical Analysis Plan",
      "location": "outputs/sap-final.md"
    }
  ]
}
```

## ADaM target mapping (bridge to protocol-to-tfl / define.xml)

Each `Analysis` reads an ADaM analysis dataset. Record it in `adamTarget` so the
metadata links to the downstream `protocol-to-tfl` pipeline and to define.xml /
Analysis Results Metadata (ARM) lineage:

| Endpoint / analysis | ADaM target |
|---|---|
| Subject-level, disposition, demographics, populations | **ADSL** (always present) |
| Time-to-event (OS, PFS, DOR, TTE safety) | **ADTTE** |
| Tumour response (ORR, BOR, DCR, RECIST) | **ADRS** |
| Adverse events / AESI | **ADAE** |
| Labs / vitals / ECG | **ADLB / ADVS / ADEG** |
| Continuous BDS endpoints (rating scales, change from baseline) | **BDS (e.g. ADQS)** |

Real SAPs rarely name ADaM/ARS — supplying this mapping is the traceability edge.

## Consistency rules

- Every `analyses[].analysisSetId` resolves to an `analysisSets[].id`; every
  `methodId` to an `analysisMethods[].id`; every `outputId` to an `outputs[].id`;
  every `orderedGroupingFactorIds`/`dataSubsetIds` entry to its respective array.
- Every primary and secondary endpoint in `study-design.json` is referenced by at
  least one `analyses[]._endpoint_id`.
- Every `analyses[].adamTarget` is a recognized ADaM dataset (see the table).
- `analyses[].reason` and `analysisMethods[]._is_sap_decision` must agree: an
  analysis whose method was introduced by the SAP carries
  `reason: "SPECIFIED IN SAP"` and `_is_sap_decision: true`.
- The `_*` link fields exist so `traceability-matrix.json`,
  `analysis-metadata.json`, and `study-design.json` cross-reference by id without
  ambiguity. Keep them exact.
