---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, ctcae, adverse-events, grading, safety]
---

**CTCAE = Common Terminology Criteria for Adverse Events. 5-point severity scale on every AE. Grade 5 = death related to AE.**

## Scale

| Grade | Meaning |
|-------|---------|
| 1 | Mild. Asymptomatic or mild. No intervention. |
| 2 | Moderate. Minimal / local / non-invasive intervention. |
| 3 | Severe / medically significant. Hospitalisation indicated. Not immediately life-threatening. |
| 4 | Life-threatening. Urgent intervention. |
| 5 | Death related to AE. |

## Where

- Vars: `CTCAE_GRADE`, `AETOXGR` (SDTM AE).
- Zod schemas in `packages/platform-core/src/schemas/` on clinical workflows.
- Plugin prompts with severity thresholds ("grade 3+ hepatotoxicity").

## Companion signals (not CTCAE grades)

- **irAE** — immune-related AE. Checkpoint-inhibitor class.
- **Hy's Law** — DILI signal. ALT ≥ 3× ULN + total bilirubin ≥ 2× ULN + no alt cause.

## External

- NCI CTCAE v5.0: https://ctep.cancer.gov/protocolDevelopment/electronic_applications/ctc.htm

## Related

- [cdisc-sdtm](./cdisc-sdtm.md) — AE domain carries grades.
- [pharma-domain-context](./pharma-domain-context.md).

## Sources

- `AGENTS.md` → "Pharma Domain Context"
- NCI CTCAE v5.0 (external)
