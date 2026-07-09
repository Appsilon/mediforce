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
crowd the ADR.

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

- [0001 — Move primary datastore from Firestore to self-hosted Postgres](./0001-firestore-to-postgres.md) (+ [PLAN](./PLAN-0001.md))
- [0002 — Move authentication from Firebase Auth to NextAuth (Auth.js v5)](./0002-firebase-auth-to-nextauth.md) (+ [PLAN](./PLAN-0002.md))
- [0004 — Authorization enforcement moves to a scoped data-access layer](./0004-scoped-data-access-authorization.md)
- [0005 — Headless platform: API/UI separation](./0005-headless-platform-api-ui-separation.md)
- [0006 — Client-side server-state management](./0006-client-side-server-state.md)
