---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, cdisc, sdtm, adam, clinical-data]
---

**CDISC SDTM = raw collected data. ADaM = analysis-ready derived data. TFL = submission output. Pipeline: SDTM → ADaM → TFL.**

## Layers

- **SDTM** — one domain per row-type. DM (demographics), AE (adverse events), LB (labs), CM (concomitant meds), EX (exposure), VS (vitals). Standard vars: `AEDECOD`, `AESER`, `AESTDTC`, `USUBJID`. One row per event.
- **ADaM** — derived from SDTM. One row per analysis unit. Derived flags, treatment vars, visit windows.
- **TFL** — Tables, Figures, Listings. Produced from ADaM.

## Where

- Variable names in prompts + plugin configs.
- Runtime skills in `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/`:
  - `sdtm-to-adam` — ADaM derivation.
  - `adam-to-tlg` — TFL generation.
  - `adam-to-teal` — R-based Teal app.
- Zod schemas in `packages/platform-core/src/schemas/` when clinical workflows touch it.

## External

- SDTM IG: https://www.cdisc.org/standards/foundational/sdtm
- ADaM IG: https://www.cdisc.org/standards/foundational/adam

## Related

- [recist-v1-1](./recist-v1-1.md) — RECIST → ADRS (ADaM).
- [ctcae-grading](./ctcae-grading.md) — grades in SDTM AE.
- [protocol-to-tfl](../entities/apps/protocol-to-tfl.md) — consumer.

## Sources

- `apps/protocol-to-tfl/src/protocol-to-tfl.wd.json`
- `AGENTS.md` → "Pharma Domain Context"
