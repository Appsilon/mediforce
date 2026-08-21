---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, ich-gcp, regulatory, compliance]
---

**ICH-GCP = International Council for Harmonisation, Good Clinical Practice (E6 R3). Regulatory framework for clinical-trial conduct on humans.**

## Scope

- Informed consent.
- IRB/IEC oversight.
- Investigator + sponsor obligations.
- Essential documents (TMF).
- Data integrity — **ALCOA+**: Attributable, Legible, Contemporaneous, Original, Accurate, + Complete, Consistent, Enduring, Available.
- AE reporting obligations.

## Why it matters here

Every agent action on clinical data = audit event. Don't bypass audit logging. Regulatory requirement, not performance knob.

Mapping:

- **Immutable versions** (`DefinitionVersionAlreadyExistsError`) → ALCOA+ data integrity.
- **Audit events** (`AuditRepository`, `StepExecution`) → ALCOA+ attributability + contemporaneity.
- **Autonomy levels** → regulated oversight patterns. Submission-bound = L2/L3. See [autonomy-levels](./autonomy-levels.md).

## External

- ICH E6(R3): https://www.ich.org/page/efficacy-guidelines

## Related

- [pharma-domain-context](./pharma-domain-context.md).
- [autonomy-levels](./autonomy-levels.md).
- [repository-pattern](./repository-pattern.md) — audit trail is first-class.

## Sources

- `AGENTS.md` → "Pharma Domain Context"
- ICH E6(R3) (external)
