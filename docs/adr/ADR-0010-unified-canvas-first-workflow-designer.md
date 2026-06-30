# ADR-0010: Unified Canvas-First Workflow Designer

**Status:** Proposed
**Date:** 2026-06-30

## Context

Mediforce currently has two separate ways to create workflows:

1. **Visual Workflow Designer** — a split-pane XYFlow canvas with a step editor
   in the right column. Produces versioned workflow definitions.

2. **Co-Work Workflow Designer Workflow** — a cowork session (chat-driven, backed
   by the Mediforce workflow engine) specifically designed to help users author
   workflows through conversation.

This split creates compounding problems:

- Users face two different mental models and entry points for the same goal.
- The cowork-session approach makes the AI assistant the *primary* entity and the
  canvas secondary — which is backwards for workflow authoring, where the
  structure is the artifact.
- The cowork-session approach requires the workflow engine running in the backend
  to power what is fundamentally a design-time tool, adding operational complexity
  that does not belong at design time.
- Lessons learned from both paradigms have never been reconciled into a single
  coherent experience.

## Decision

Replace both paradigms with a single **Unified Canvas-First Workflow Designer**.
This becomes the only way to create and edit workflows in Mediforce.

### Design principles

**Canvas is primary.**
The XYFlow canvas occupies the full main area. The workflow structure — not the
conversation — is the artifact. All workflow state lives on the canvas.

**AI Assistant is secondary in hierarchy, not in capability.**
The chat panel lives in a collapsible right sidebar and does not drive the
interface. However it can add blocks, wire transitions, and construct a full
workflow on the user's behalf — the same power the Co-Work Workflow Designer
Workflow had. The canvas remains the source of truth; the assistant is one way
to build it, not the only way.

**Step config in the right sidebar.**
Selecting a node surfaces its configuration in the same right sidebar. The AI
Assistant yields to the step editor when a node is selected and returns when the
selection is cleared.

**Two ways to add a block coexist.**
"Add Block" (bottom toolbar) places an unconnected node anywhere on the canvas.
The "+" edge button connects a new node inline at a specific position. Neither
replaces the other.

**Block presets — show what is possible.**
A thin mapping layer (`lib/block-presets.ts`) groups existing step types into
user-facing categories (Agents, Conditions, Database, Script, Utilities, Human)
with sensible defaults and descriptions. No new schema is introduced — it is a
lookup table that makes the picker legible and communicates the platform's
capabilities to new users.

**Does not run on the workflow engine.**
The designer is a standalone UI feature. It does not require a running workflow
engine session, a cowork workflow, or a BullMQ job to function. UI-level
components (e.g. the chat shell from the cowork view) may be reused where
appropriate, but there is no engine dependency at design time.

## Consequences

- The Co-Work Workflow Designer Workflow is deprecated and removed as a
  workflow creation path.
- `workflow-editor-canvas.tsx` is restructured: the two-column split layout is
  replaced with a full-width canvas + right sidebar.
- `step-editor.tsx` form logic is preserved entirely and rendered inside the
  right sidebar — no form logic is rewritten.
- `lib/block-presets.ts` is the only new abstraction introduced at this stage.
- All existing step types (agent, script, human, cowork, action, decision) and
  all control modes (CM0–CM4) remain fully supported.
- All workflow creation and editing goes through this designer exclusively.

## Implementation order

```
Step 0  lib/block-presets.ts — mapping file only, no UI
Phase 1 Layout restructure — full-width canvas + right sidebar shell
Phase 2 Add Block button + block picker popover wired to presets
Phase 3 Step config in right sidebar — validate all step types render correctly
Phase 4 AI Assistant shell → capability wiring (canvas mutations from chat)
```

Each phase is independently shippable. Phase 4 capability wiring (AI → canvas
mutations) may be deferred to a follow-up PR.

## Related

- ADR-0006b: Control mode is a UI concept (CM0–CM4 mapping reused as-is)
- ADR-0008: Step executor model (executor types reused as-is)
- PR #783: Autonomy levels refactor — workflow designer & execution history
  overhaul (foundation this work builds on)
