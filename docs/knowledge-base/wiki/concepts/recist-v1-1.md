---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, recist, oncology, tumour-response]
---

**RECIST v1.1 = Response Evaluation Criteria In Solid Tumours. Standard rules for tumour-burden change classification: CR, PR, SD, PD.**

## Categories

| Code | Meaning |
|------|---------|
| CR | Complete Response. Target lesions gone. |
| PR | ≥30% decrease in sum of diameters vs baseline. |
| SD | Neither PR nor PD. |
| PD | ≥20% increase vs nadir OR new lesions. |

Derived endpoints: ORR, DCR, PFS, DoR.

## Where

- ADRS in ADaM (see [cdisc-sdtm](./cdisc-sdtm.md)).
- TR / TU domains in SDTM (target + non-target lesions).
- Plugin prompts for tumour-response narrative.

## Variants

- **iRECIST** — immunotherapy (handles pseudo-progression).
- **RECIL** — lymphoma.

## External

- Eisenhauer et al., *Eur J Cancer* 2009, 45(2):228–247.

## Related

- [cdisc-sdtm](./cdisc-sdtm.md) — RECIST → ADRS.
- [pharma-domain-context](./pharma-domain-context.md).

## Sources

- `AGENTS.md` → "Pharma Domain Context"
- Eisenhauer et al. (external)
