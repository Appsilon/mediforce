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

| ARS object | What it captures | Maps from study-design.json |
|---|---|---|
| `ReportingEvent` | The container for one reporting effort (this SAP). | The study itself (`study_identification.study_id`). |
| `AnalysisSet` | A population the analysis runs on. | `populations[]`. |
| `DataSubset` | A filter within a set (e.g. responders, a visit). | derived from endpoint `timing` / analysis filters. |
| `GroupingFactor` | A categorical split (e.g. treatment arm, subgroup). | `study_design.treatment_arms[]`, subgroup analyses. |
| `AnalysisMethod` | A reusable statistical method definition. | `analysis_requirements[].method` (or SAP DECISION default). |
| `Analysis` | One planned analysis: references a method, a set, optional subsets and grouping factors, and the endpoint it serves. | `analysis_requirements[]`. |
| `Output` / `Display` | The table/figure/listing the analysis populates. | SAP §15 planned-TLG list. |

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
      "condition": "string — verbatim population definition",
      "_population_id": "string — link to study-design populations[].population_id"
    }
  ],
  "dataSubsets": [
    {
      "id": "DS-<short>",
      "label": "string",
      "condition": "string — the filter expressed in words or a simple predicate"
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
      "description": "string — operation summary (model, covariates, estimate, CI)",
      "_is_sap_decision": "boolean — true if introduced by the SAP, not the protocol"
    }
  ],
  "analyses": [
    {
      "id": "AN-<requirement_id>",
      "label": "string — e.g., 'Primary analysis of Overall Survival'",
      "purpose": "primary | secondary | sensitivity | subgroup | safety | exploratory",
      "reason": "string — e.g., 'SPECIFIED IN SAP' or 'SPECIFIED IN PROTOCOL'",
      "methodId": "AM-<short>",
      "analysisSetId": "AS-<population_id>",
      "dataSubsetIds": ["DS-<short>"],
      "groupingFactorIds": ["GF-TRT"],
      "_endpoint_id": "string — study-design endpoints.<tier>[].endpoint_id (tier = primary|secondary|exploratory|safety)",
      "_analysis_requirement_id": "string — study-design analysis_requirements[].requirement_id",
      "_sap_section": "string — e.g., '6.1'",
      "outputId": "OUT-<short>"
    }
  ],
  "outputs": [
    {
      "id": "OUT-<short>",
      "label": "string — TLG title",
      "displayType": "table | figure | listing",
      "number": "string or null — CSR-aligned number if known"
    }
  ]
}
```

## Consistency rules

- Every `analyses[].analysisSetId` resolves to an `analysisSets[].id`; every
  `methodId` to an `analysisMethods[].id`; every `outputId` to an `outputs[].id`;
  every `groupingFactorIds`/`dataSubsetIds` entry to its respective array.
- Every primary and secondary endpoint in `study-design.json` is referenced by at
  least one `analyses[]._endpoint_id`.
- `analyses[].reason` and `analysisMethods[]._is_sap_decision` must agree: an
  analysis whose method was introduced by the SAP carries
  `reason: "SPECIFIED IN SAP"` and `_is_sap_decision: true`.
- The `_*` link fields exist so `traceability-matrix.json`,
  `analysis-metadata.json`, and `study-design.json` cross-reference by id without
  ambiguity. Keep them exact.
