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

## New Wizard Flow

The step editor is replaced by a three-step wizard.

**Step 1 — Pick a control mode** (replaces the current "step type + executor" combo)

**Step 2 — Mode-specific configuration**

**Step 3 — Pick a step type** (`creation` or `decision`)

---

## Control Modes

| Mode | Label | Schema mapping |
|------|-------|---------------|
| 0 | No agent | `executor: 'human'` OR `executor: 'script'` OR `executor: 'action'` |
| 1 | Ghost | `executor: 'agent', autonomyLevel: 'L2'` |
| 2 | Cowork | `executor: 'cowork'` |
| 3 | Human review | `executor: 'agent', autonomyLevel: 'L3'` |
| 4 | Full autonomy | `executor: 'agent', autonomyLevel: 'L4'` |

The word "executor" is never shown to users in the new flow.

---

## Mode-Specific Configuration (Step 2)

- **Mode 0:** "How is this step executed?" → human / script / action (sets `executor` field)
- **Modes 1, 3, 4:** Agent picker (sets `agentId`)
- **Mode 2:** Cowork type picker — chat or voice-realtime

---

## Step Type Picker (Step 3)

Only `creation` and `decision` are offered when creating new steps. `review` is retained in the schema for backward compatibility but is not available in the wizard. `terminal` is auto-managed by the designer and never appears in the picker.

---

## L0 and L1

L0 and L1 are not exposed in any wizard UI. They are instrumentation flags for developer use only, set via raw JSON. This surface is out of scope for this refactor.

If a stored step has `autonomyLevel: 'L0'` or `'L1'`, the wizard silently displays it as Mode 0. No warning is shown. Because control mode is never written back to the schema, the stored value is unchanged.
