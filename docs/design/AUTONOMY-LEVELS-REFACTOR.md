# Autonomy Levels Refactor

**Status**: Proposed  
**Author**: Paweł Przytuła  
**Date**: 2026-05-07

---

## Current State

Every workflow step has an `executor` type and, for agent steps, an optional `autonomyLevel`:

**Executor types** (`human | agent | script | cowork | action`)

**Autonomy levels for agent steps** (`L0 | L1 | L2 | L3 | L4`):

| Level | Badge label | Runtime behaviour |
|-------|-------------|------------------|
| L0 | Observer | Agent runs silently; output not surfaced to workflow |
| L1 | Shadow | Output stored for comparison only; not shown in workflow |
| L2 | Annotator | Annotations written to event log; human still decides |
| L3 | Advisor | Agent recommends; workflow pauses for human approval |
| L4 | Autopilot | Agent result applied directly; workflow continues |

**Cowork** is a separate executor type with its own session infrastructure (chat and voice-realtime modes). It opens an interactive human-agent workspace that produces a structured artifact before the step completes.

In production, `L0`, `L1`, and `L2` are almost never used in real workflows. The cowork executor is actively used but lives outside the autonomy level model entirely.

---

## Problems with the Current Design

### 1. L0–L4 labels are opaque to users

The numeric labels carry no inherent meaning. A workflow designer configuring a step has to remember what each number means, and different parts of the UI use different label sets for the same levels ("L2 — Auto if confident" vs "L2 — Supervised" vs "Annotator"), which adds to the confusion.

### 2. Three invisible levels are too fine-grained

L0, L1, and L2 all result in the same outcome from the workflow's perspective: nothing changes, the human still decides. The differences between them (whether the output is stored, and where) are instrumentation concerns, not workflow design decisions. Presenting them as first-class modes clutters the model without adding value for the workflow author.

### 3. The axis conflates two orthogonal concerns

The L0–L4 scale mixes two distinct questions:

- *When does the human see the result?* (L0: never, L1: in logs, L2: as annotation)
- *Can the human block the workflow from advancing?* (L3: yes, L4: no)

Merging these into a single opaque progression made the levels hard to reason about.

### 4. Cowork is orphaned from the autonomy model

Cowork is the most human-controlled form of agent involvement — the human steers every turn of the conversation — yet it sits in a completely separate `executor` enum, disconnected from the L0–L4 scale. This forces workflow authors to think about two separate configuration axes when really they are answering a single question: *how much control does the human have over this step?*

### 5. The human step type is implicit

There is no explicit "no agent" step type. A human step is simply an agent step with L0, or a step with no agent configuration at all. This makes the default case — a plain human task — harder to express and understand.

---

## Proposed Solution

Replace the `executor` type + `autonomyLevel` pair with a single **control mode** that unifies both concepts into one axis. Remove `cowork` as a separate executor type.

### New control modes

| Mode | Label | Primary actor | Human role | Agent role |
|------|-------|--------------|-----------|-----------|
| 0 | **Manual** | Human | Does the work | None |
| 1 | **Assist** | Human | Does the work | Provides a suggestion or draft alongside |
| 2 | **Collaborate** | Both | Drives the session | Responds turn-by-turn in interactive session |
| 3 | **Approve** | Agent | Reviews and gates the output | Completes the step |
| 4 | **Autopilot** | Agent | Audit trail only | Completes the step |

### The unifying axis: who is the primary actor?

The progression from 0 to 4 is a clean handoff of responsibility from human to agent:

- **0 (Manual)**: The agent has no role. This is a pure human task.
- **1 (Assist)**: The human does the work. The agent fires once and provides a suggestion or draft that the human can use or ignore. The human completes the step.
- **2 (Collaborate)**: Neither side is primary. The human and agent engage in an interactive session (the current cowork infrastructure) until a structured artifact is produced. The step completes when the human finalises the output.
- **3 (Approve)**: The agent is primary. It completes the step and produces a result. The workflow pauses — the human reviews and either approves (workflow advances) or rejects.
- **4 (Autopilot)**: The agent is primary. Its result is applied immediately. No human involvement in the step itself.

### What gets removed

- The `L0`, `L1`, `L2`, `L3`, `L4` enum and all labels derived from it.
- The `cowork` executor type (absorbed into mode 2, Collaborate).
- Human-executor `creation` step type (absorbed into mode 0, Manual).
- The separate `autonomyLevel` field on workflow steps — control mode replaces it entirely.

### What L0/L1/L2 become

The silent-observer and shadow behaviours (current L0–L2) were developer instrumentation, not workflow concepts. If this capability is still needed, it should be expressed as a **debug flag** on any mode — separate from the control model, not part of it. This is out of scope for this refactor.

---

## Migration

This is a **breaking change** to the workflow definition schema. Existing `workflowDefinitions` in Firestore will need to be migrated. Given that production workflows use almost exclusively `L3`, `L4`, and `cowork`, the mapping is straightforward:

| Current | Migrates to |
|---------|-------------|
| `executor: human` | Mode 0 — Manual |
| `executor: agent, autonomyLevel: L3` | Mode 3 — Approve |
| `executor: agent, autonomyLevel: L4` | Mode 4 — Autopilot |
| `executor: cowork` | Mode 2 — Collaborate |

A one-off migration script will rewrite stored workflow definition versions. Because versions are immutable in Firestore, migration will write new versions rather than mutating existing records.
