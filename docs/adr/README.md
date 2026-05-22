# Architectural Decision Records

Short documents capturing significant architectural decisions, the rejected
alternatives, and the rationale.

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
- `Accepted` — merged, decision is binding
- `Deprecated` — no longer applies, kept for history
- `Superseded by NNNN` — replaced by a later ADR

## Index

- [0001 — Move primary datastore from Firestore to self-hosted Postgres](./0001-firestore-to-postgres.md) (+ [PLAN](./PLAN-0001.md))
- [0002 — Move authentication from Firebase Auth to NextAuth (Auth.js v5)](./0002-firebase-auth-to-nextauth.md) (+ [PLAN](./PLAN-0002.md))
