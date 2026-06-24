# 0006 — Control mode is a UI concept

> **Status: Implemented.** The control mode UI concept described here is now live. See the implementation design: [AUTONOMY-LEVELS-REFACTOR.md](../design/AUTONOMY-LEVELS-REFACTOR.md).

- **Status:** Accepted
- **Date:** 2026-05-27
- **Author:** Paweł Przytuła (@przytu1)

## Context

Workflow steps are configured with two fields:

- `executor: 'human' | 'agent' | 'script' | 'cowork' | 'action'` — who or
  what carries out the step.
- `autonomyLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'` (optional) — how much
  agent autonomy is granted when `executor` is `'agent'`.

Together they encode "how much human control" a step has, but configuring
them directly is confusing: the fields are split, `autonomyLevel` is
meaningless without an `agent` executor, and the L-number semantics are
opaque to workflow authors.

The wizard UI needs a simpler mental model. "Control mode" (0–4) is that
model — a single axis from full human control to full agent autonomy.

## Decision

Control mode is a **UI-only concept**. It is derived at render time from the
stored `executor` + `autonomyLevel` values and never written to the workflow
definition schema. The underlying schema fields are unchanged.

### Mapping table

C-levels (C0–C4) are the UI labels shown in the step picker. They are a presentational axis only and are unrelated to the `autonomyLevel` L0–L4 schema field.

| C-level | Label | `executor` | `autonomyLevel` | Wizard |
|---|---|---|---|---|
| C0 | No agent | `human` OR `script` OR `action` | — | Enabled |
| C1 | Assist | — | — | **Disabled (coming soon)** |
| C2 | Cowork | `cowork` | — | Enabled |
| C3 | Human review | `agent` | `L3` | Enabled |
| C4 | Autonomous agent | `agent` | `L4` | Enabled |

`executor: 'agent', autonomyLevel: 'L2'` is retained in the schema for backward compat; it maps to the 'assist' control mode for display of existing steps only. No new L2 steps can be created from the wizard.

The mapping is 1:1 and deterministic in both directions. The wizard reads
stored values → derives the active control mode; on save it maps the selected
control mode → writes `executor` + `autonomyLevel`.

L0 and L1 instrumentation modes have no wizard UI; they can only be set via
raw JSON.

## Considered alternatives

### 1. Schema rename — replace fields with a `controlMode` integer

Rename `executor` + `autonomyLevel` to a single `controlMode: 0 | 1 | 2 | 3 | 4`
with a Firestore migration writing new workflow definition versions.

Rejected because:

- The workflow engine branches execution logic on `executor` and
  `autonomyLevel` today. Renaming requires coordinated engine + migration
  changes — significant scope for a pure UX improvement.
- Production workflow definitions are immutable versioned records. A migration
  writing new versions inflates version history without any functional change.

### 2. Dual-write — add `controlMode` alongside existing fields

Persist `controlMode` as an optional field and keep `executor` +
`autonomyLevel`. Wizard writes all three; engine ignores `controlMode`.

Rejected because it creates a third source of truth for the same concept, with
no canonical read authority and no mechanical way to detect drift between the
three fields. Future readers of the schema could not trust any of them.

### 3. UI-only (chosen)

Derive at render time, map back on write. No schema change, no migration, no
dual-write.

## Consequences

- The workflow definition schema is stable; no migration script needed.
- The wizard derives control mode at read time and maps back to
  `executor`/`autonomyLevel` at write time using the table above.
- `type: 'review'` steps keep working for existing workflows; the wizard
  stops offering it as a choice for new steps.
- L0 and L1 modes are accessible only via raw JSON editing.
- The mapping table in this ADR is the single source of truth for the
  control-mode ↔ schema-fields correspondence. Any change to the mapping
  requires amending this ADR.
- "Full autonomy" was renamed to "Autonomous agent" (C4) in June 2026.
  Schema value `L4` is unchanged. See AUTONOMY-LEVELS-REFACTOR.md.
