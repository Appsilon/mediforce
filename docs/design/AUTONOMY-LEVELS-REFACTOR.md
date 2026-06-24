# Autonomy Levels Refactor

**Status**: Accepted  
**Author**: Paweł Przytuła  
**Date**: 2026-05-07

---

## Scope

This is a **UI-only refactor.** No schema changes, no migration.

The fields `executor` and `autonomyLevel` on workflow steps remain exactly as they are in `platform-core`. `controlMode` is a UI concept only — it is never written to the schema.

---

## Current State

Every workflow step carries an `executor` type and, for agent steps, an optional `autonomyLevel`:

**Executor types:** `human | agent | script | cowork | action`

**Autonomy levels for agent steps:** `L0 | L1 | L2 | L3 | L4`

The current step editor surfaces these raw schema values directly to the user. The combination of "step type" + "executor" that opens the editor is confusing, and the L0–L4 labels carry no inherent meaning for workflow designers.

---

## New Picker Flow

The "add new step" popover is a single screen with two sections visible simultaneously (replacing the previous 3-step wizard):

**Section 1 — "What do you want to do in this step?"**  
Two toggle buttons: *Create new output* / *Make a decision*. Defaults to *Create new output* when the popover opens. Controls the `type` field of the new step.

**Section 2 — "Who executes this step?"**  
Executor options grouped by C-level (see below). Clicking any enabled option immediately creates the step using the type selected in Section 1. No further wizard steps — agent ID and cowork mode are configured post-creation in the step editor.

---

## C-Level System (UI only)

The C-level (C0–C4) is a UI-only classification axis visible in the picker. It is **not related to the L0–L4 `autonomyLevel` schema field** and is never written to storage. It replaces the old 0–4 numeric mode labels.

| C-level | Label | Schema mapping | Wizard state |
|---------|-------|---------------|--------------|
| C0 | No agent | `executor: 'human'` OR `'script'` OR `'action'` | Enabled — three sub-options |
| C1 | Assist | Not yet implemented | **Disabled — "coming soon"** |
| C2 | Cowork | `executor: 'cowork'` | Enabled — defaults to `cowork.agent: 'chat'` |
| C3 | Human review | `executor: 'agent', autonomyLevel: 'L3'` | Enabled |
| C4 | Autonomous agent | `executor: 'agent', autonomyLevel: 'L4'` | Enabled |

The word "executor" is never shown to users in the picker.

---

## Assist (C1) — Design Note

Assist is defined as: *human leads and executes the step; AI reviews the result*. This requires platform support not yet in place. The option is shown in the wizard but disabled with a "coming soon" label.

The old "Ghost" mapping (`executor: 'agent', autonomyLevel: 'L2'`) is retained in the schema for backward compatibility. Existing steps with `autonomyLevel: 'L2'` continue to display the "Assist" badge. However, L2 is no longer creatable from the wizard — it is accessible only via raw YAML. The consolidation of L2 into L3 (both have AI doing the work with human review) is deferred to a future iteration.

---

## "Autonomous agent" Replaces "Full autonomy"

The label "Full autonomy" has been renamed to **"Autonomous agent"** throughout the UI, docs, and code. The schema value `autonomyLevel: 'L4'` is unchanged. The rename applies to:
- `CONTROL_MODE_LABELS['autonomous-agent']`
- All badge displays, step editor dropdowns, and documentation
- The internal ControlMode TypeScript type key: `'full-autonomy'` → `'autonomous-agent'`

---

## L0 and L1

L0 and L1 are not exposed in any wizard UI. They are instrumentation flags for developer use only, set via raw JSON. This surface is out of scope for this refactor.

If a stored step has `autonomyLevel: 'L0'` or `'L1'`, the wizard silently displays it as C0 (No agent). No warning is shown. Because control mode is never written back to the schema, the stored value is unchanged.

---

## Decisions from Design Grilling (2026-06-22)

1. **Assist (C1) definition**: Assist means "human leads and executes; AI reviews the result". The original "Ghost" label (L2 = "agent drafts; human approves") is retired from the wizard. Existing L2 steps display as "Assist" for backward compat. Assist in the wizard is disabled pending implementation. The name "Ghost" was changed to "Assist" in June 2026 for clarity.

2. **C-levels are new, not L-levels**: The C0–C4 taxonomy shown in the wizard UI is a new classification axis. It does not map 1:1 to the L0–L4 `autonomyLevel` schema field. C-levels are a presentational grouping only.

3. **Single-screen picker**: The old 3-step wizard (mode → config → step type) is replaced by a single popover with two simultaneous sections. Agent ID and cowork mode selection are deferred to the step editor panel.

4. **Step type first**: Step type (creation/decision) is now the first selection — Section 1 — with a default of "creation". Clicking an executor in Section 2 immediately creates the step.

5. **"Autonomous agent" throughout**: The rename applies to all UI labels, TypeScript types, ADR, CHANGELOG, and docs. Schema value `L4` is unchanged.
