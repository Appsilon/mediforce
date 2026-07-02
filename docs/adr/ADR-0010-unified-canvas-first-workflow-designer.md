# ADR-0010: Unified Canvas-First Workflow Designer

**Status:** Proposed
**Date:** 2026-06-30

## Context

Mediforce currently has two separate ways to create workflows:

1. **Visual Workflow Designer** — a split-pane XYFlow canvas with a step editor in the right column. Produces versioned workflow definitions.
2. **Co-Work Workflow Designer Workflow** — a cowork session (chat-driven, backed by the Mediforce workflow engine) specifically designed to help users author workflows through conversation.

This split creates compounding problems:

- Users face two different mental models and entry points for the same goal.
- The cowork-session approach makes the AI assistant the *primary* entity and the canvas secondary — which is backwards for workflow authoring, where the structure is the artifact.
- The cowork-session approach requires the workflow engine running in the backend to power what is fundamentally a design-time tool, adding operational complexity that does not belong at design time.
- Lessons learned from both paradigms have never been reconciled into a single coherent experience.

## Decision

Replace both paradigms with a single **Unified Canvas-First Workflow Designer**. This becomes the only way to create and edit workflows in Mediforce.

### Design principles

**Canvas is primary.**
The XYFlow canvas occupies the full main area. The workflow structure — not the conversation — is the artifact. All workflow state lives on the canvas.

**AI Assistant is secondary in hierarchy, not in capability.**
The chat panel lives in a collapsible right sidebar and does not drive the interface. However it can add blocks, wire transitions, and construct a full workflow on the user's behalf — the same power the Co-Work Workflow Designer Workflow had. The canvas remains the source of truth; the assistant is one way to build it, not the only way.

**Step config in the right sidebar.**
Selecting a node surfaces its configuration in the same right sidebar. The AI Assistant yields to the step editor when a node is selected and returns when the selection is cleared.

**Two ways to add a block coexist.**
"Add Block" (bottom toolbar) places an unconnected node anywhere on the canvas. The "+" edge button connects a new node inline at a specific position. Neither replaces the other.

**Block presets — show what is possible.**
A thin mapping layer (`lib/block-presets.ts`) groups existing step types into user-facing categories (Agents, Conditions, Database, Script, Utilities, Human) with sensible defaults and descriptions. No new schema is introduced — it is a lookup table that makes the picker legible and communicates the platform's capabilities to new users.

**Does not run on the workflow engine.**
The designer is a standalone UI feature. It does not require a running workflow engine session, a cowork workflow, or a BullMQ job to function. UI-level components (e.g. the chat shell from the cowork view) may be reused where appropriate, but there is no engine dependency at design time.

### AI Assistant — reuse from the Co-Work Workflow Designer Workflow

The Co-Work Workflow Designer Workflow (`apps/workflow-designer/src/workflow-designer.wd.json`) is deprecated as a workflow-creation *path* (see Consequences), but several of its building blocks are engine-independent and are reused by the new AI Assistant pane.

**Minimum spec for the AI Assistant:**

1. Define a workflow from a natural-language description.
2. Suggest and answer questions.
3. Know when to design vs. answer vs. ask a clarifying question.
4. Be configurable — choice of model, with a sensible default.

**Reused as-is (no engine dependency):**

- `getWorkflowAuthorableJsonSchema()` in `packages/platform-core/src/schemas/workflow-definition.ts` — produces a JSON Schema matching `WorkflowStep`/`Transition` shape. Used to constrain the assistant's generation output.
- `docs/workflow-examples/` (10 examples + `anti-patterns/*.json` with `why`/`fix` fields), loaded via `loadWorkflowExamples()` in `packages/platform-core/src/workflow-examples.ts` — few-shot material for generation quality.
- `callOpenRouter()` in `packages/platform-api/src/services/openrouter-client.ts` — generic chat-completions + tool-calling wrapper, not cowork-specific.
- `ModelPicker` (`packages/platform-ui/src/components/workflows/workflow-editor/model-picker.tsx`) — drop-in model selector (registry-backed, context/pricing/tools/vision badges, custom model ID support). Satisfies spec (4) directly.
- The `DEFAULT_MODEL = 'anthropic/claude-sonnet-4'` fallback convention from `packages/platform-api/src/handlers/cowork/chat.ts` — same default-with-override pattern for spec (4).
- The message-list/bubble/input chat UI from `packages/platform-ui/src/components/cowork/chat-cowork-view.tsx` — reused for the pane's chat shell, **excluding** the artifact-panel, session-polling, and finalize/dry-run plumbing, which are engine-coupled.

**Adapted, not reused verbatim:**

- The `design` step's system prompt in `workflow-designer.wd.json` assumes the engine's `update_artifact` tool-call loop and dry-run flow. Its phrasing and structure (ask-before-building, tool-usage rules, communication style) inform the new prompt, but the prompt itself is rewritten for a canvas-mutation tool contract instead of an artifact-update contract.

**Built new (nothing existed to reuse):**

- Spec (3), routing between "design" / "answer" / "ask": the existing system has no classifier — it relies entirely on prompt wording and the LLM's own choice of whether to emit a tool call. The new assistant follows the same pattern (a single tool-call-or-not decision per turn) rather than introducing a separate classification step, since no prior art suggested a more reliable approach was already validated.
- The canvas-mutation tool schema and its handlers — translating an LLM tool call into calls against the existing `addStep`/`updateStep`/`removeStep`/etc. functions already in `workflow-editor-canvas.tsx`. The Co-Work Designer Workflow's equivalent (`update_artifact`) mutated a JSON artifact tracked by the engine, which does not apply here.
- Streaming: not present anywhere in the current cowork implementation (explicitly deferred, see `docs/adr/draft/cowork-streaming.md` and issue #516). Request/response is the starting point for the AI Assistant pane too; streaming is a follow-up if response latency proves it necessary.

## Consequences

- The Co-Work Workflow Designer Workflow is deprecated and removed as a workflow creation path.
- `workflow-editor-canvas.tsx` is restructured: the two-column split layout is replaced with a full-width canvas + right sidebar.
- `step-editor.tsx` form logic is preserved entirely and rendered inside the right sidebar — no form logic is rewritten.
- `lib/block-presets.ts` is the only new abstraction introduced at this stage.
- All existing step types (agent, script, human, cowork, action, decision) and all control modes (CM0–CM4) remain fully supported.
- All workflow creation and editing goes through this designer exclusively.

## Implementation order

```
Step 0  lib/block-presets.ts — mapping file only, no UI
Phase 1 Layout restructure — full-width canvas + right sidebar shell
Phase 2 Add Block button + block picker popover wired to presets
Phase 3 Step config in right sidebar — validate all step types render correctly
Phase 4 AI Assistant shell → capability wiring (canvas mutations from chat, see "AI Assistant — reuse from the Co-Work Workflow Designer Workflow" above for what's reused vs. built new)
```

Each phase is independently shippable. Phase 4 capability wiring (AI → canvas mutations) may be deferred to a follow-up PR.

## Related

- ADR-0006b: Control mode is a UI concept (CM0–CM4 mapping reused as-is)
- ADR-0008: Step executor model (executor types reused as-is)
- PR #783: Autonomy levels refactor — workflow designer & execution history overhaul (foundation this work builds on)
- `apps/workflow-designer/src/workflow-designer.wd.json`: the Co-Work Workflow Designer Workflow this ADR deprecates as a creation path — source of the reusable pieces documented above
- `docs/adr/draft/cowork-streaming.md`, issue #516: streaming design, deferred for both cowork and the new AI Assistant pane
