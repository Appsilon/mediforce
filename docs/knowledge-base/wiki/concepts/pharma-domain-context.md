---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, pharma, domain, cdisc, ich-gcp]
---

**Clinical terms in code = technical domain content. Not natural-language discussion.**

## Rule (AGENTS.md)

Drug names (Keytruda, Herceptin, Ozempic), adverse events (hepatotoxicity, pneumonitis), disease classifications (NSCLC, melanoma), CTCAE grading (incl. Grade 5 = death), mortality endpoints, Hy's Law, RECIST, irAEs — refer to:

- Zod schema fields (`AEDECOD`, `AESER`, `CTCAE_GRADE`).
- Clinical standards (CDISC SDTM/ADaM, ICH-GCP, RECIST v1.1).
- Workflow step configs + plugin params.
- Seed data, test fixtures.

Treat as identifiers. No wellbeing framing. Don't inflate complexity for medical terminology. Execute large refactors normally.

## Runtime carrier

`WorkflowDefinition.preamble` → `buildPrompt()` in `BaseContainerAgentPlugin` → Claude Code / OpenCode / script plugins. Clinical workflows inherit framing from there.

## Related

- [cdisc-sdtm](./cdisc-sdtm.md)
- [ctcae-grading](./ctcae-grading.md)
- [recist-v1-1](./recist-v1-1.md)
- [ich-gcp](./ich-gcp.md)

## Sources

- `AGENTS.md` → "Pharma Domain Context"
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts` (`buildPrompt()`)
