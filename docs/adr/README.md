---
status: living
audience: engineers
last_reviewed: 2026-08-18
---

# Architectural Decision Records

Short documents capturing significant architectural decisions, the rejected
alternatives, and the rationale.

**How to read these.** ADRs are inputs to your judgement, not scripture. We
wrote them; we can be wrong; the codebase moves and so does the team's
understanding. When a prior ADR's constraint would force a worse design, the
right move is to question it — supersede in part, supersede in full, or
amend in place if still `Accepted`. Defer to a past ADR only after you've
checked it still makes sense given what you know today.

**Default to standard solutions.** Most problems we hit at the API,
persistence, and HTTP-error layers are well-trodden — outbox patterns,
repository decorators, RFC-aligned error envelopes, transactional audit
trails. Reach for the boring industry answer before inventing a Mediforce-
specific one. Custom is justified only when the standard answer demonstrably
doesn't fit the constraint.

## Process

1. Propose an ADR as a PR (status: `Proposed`). Discussion happens in PR review.
2. Merge once the team agrees (status: `Accepted`). The ADR becomes the source
   of truth.
3. To change a decision, open a new ADR that **supersedes** the old one. The
   old one stays in place with status `Superseded by NNNN` — full audit trail.
4. Implementation lives in separate PRs that reference the ADR.

## Format

Every ADR is short and focused on the decision itself. Implementation detail
goes into a separate `PLAN-NNNN.md` companion file when it would otherwise
crowd the ADR. A plan lives next to its ADR while the work is in flight and
moves to [`../archive/`](../archive/) once it has been executed — a finished
plan is a record of how something was built, not instructions for building it.
Operator runbooks (`RUNBOOK-NNNN-*.md`) follow the same rule. Every plan and
runbook written so far has been executed, so they all sit in `archive/` today.

See [grill-with-docs/ADR-FORMAT.md](../../.claude/skills/grill-with-docs/ADR-FORMAT.md)
for the template.

Domain language used in ADRs is defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Numbering

Sequential, zero-padded to four digits (`0001`, `0002`, …). Never reuse a number.

## Status values

- `Proposed` — under discussion in a PR
- `Accepted` — merged; amendments allowed as implementation surfaces
  things the original decision didn't anticipate. Each amendment is a
  normal PR-reviewed change, no extra ceremony
- `Finalized` — implementation done; locked. Changes from here happen
  via supersession only
- `Superseded by NNNN` — fully replaced by a later ADR
- `Partially superseded by NNNN` — specific sections replaced; the rest
  is still binding. Predecessor stays unedited; only its status field
  changes. The successor names which sections it supersedes
- `Deprecated` — no longer applies, kept for history

When promoting `Accepted → Finalized`, do it in whatever PR wraps the
implementation. An optional `## Implementation notes (frozen YYYY-MM-DD)`
appendix can capture what actually shipped vs the original decision body.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](./0001-firestore-to-postgres.md) | Move primary datastore from Firestore to self-hosted Postgres (+ [PLAN](../archive/PLAN-0001.md)) | Accepted |
| [0002](./0002-firebase-auth-to-nextauth.md) | Move authentication from Firebase Auth to NextAuth (Auth.js v5) (+ [PLAN](../archive/PLAN-0002.md), [RUNBOOK](../archive/RUNBOOK-0002-staging-cutover.md)) | Accepted |
| [0003](./0003-remove-firebase-storage.md) | Remove Firebase Storage: delete uploaded-skills, task attachments to a BlobStore (+ [PLAN](../archive/PLAN-0003.md)) | Proposed |
| [0004](./0004-scoped-data-access-authorization.md) | Authorization enforcement moves to a scoped data-access layer | Finalized |
| [0005](./0005-headless-platform-api-ui-separation.md) | Headless platform: API/UI separation | Accepted |
| [0006](./0006-client-side-server-state.md) | Client-side server-state management | Accepted |
| [0007](./0007-llm-evaluation-observability.md) | LLM evaluation & observability: layered model, hybrid system of record | Accepted |
| [0008](./0008-step-executor-model.md) | Step Executor Model — separating agent from script execution | Accepted |
| [0009](./0009-workflow-import-scope-boundary.md) | Workflow git import is a one-time copy from public GitHub only | Accepted |
| [0010](./0010-durable-step-timeout-recovery.md) | Durable step timeout & stranded-run recovery | Accepted |
| [0011](./0011-triggers-detached-unified-resource.md) | Triggers are detached resources in a unified table; the Workflow Definition is trigger-free | Accepted |
| [0012](./0012-unified-trigger-input-contract.md) | Trigger Input is a workflow's total input contract; every trigger validates against it | Accepted |
| [0013](./0013-workflow-packages-outside-platform-repo.md) | Workflow packages live outside the platform repo | Proposed |
| [0014](./0014-control-mode-ui-concept.md) | Control mode is a UI concept | Accepted |
| [0015](./0015-output-files-on-run-branch.md) | Output Files live on the run branch of the git workspace | Accepted |
| [0016](./0016-unified-canvas-first-workflow-designer.md) | Unified canvas-first workflow designer (+ [PLAN](../archive/PLAN-0016.md)) | Proposed |
| [0017](./0017-retire-llm-maintained-wiki.md) | Retire the LLM-maintained wiki; docs live next to what they describe (+ [PLAN](../archive/PLAN-0017.md), executed) | Accepted |
