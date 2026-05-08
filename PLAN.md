# Copy Workflow Definition to Another Namespace

Status: **IMPLEMENTED** — ready for review

## Context

Copy (not transfer/fork) a workflow definition at a specific version to another namespace. Original org keeps their workflow. Avoids dangling references, atomicity concerns, and immutable version conflicts.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| A | Scope | Only workflow definition at chosen version. Uses source's public agents by reference with target's own keys. Optionally copy public agent to customize locally. |
| B | Who can copy | Public workflows — anyone. Private — only members with access to source namespace. |
| C | UI flow | "Copy to…" button on workflow definition page (both member and public views) |
| D | Secrets | Existing preflight detects missing secrets at run time — no extra work needed |
| E | Provenance | `copiedFrom: { namespace, name, version }` — metadata only |
| F | Versioning | v1 — clean start |
| G | Editable | Yes — full copy, target namespace can modify and publish new versions immediately |
| H | Owner | User who copies |
| I | Cross-namespace | Must be member/admin of target namespace |
| J | Limits | No limits on start |
| — | Naming | "Copy" not "fork". No implied upstream sync. User chooses name (default: source name). Rejects with 409 if name already exists in target. |

## Invariants (separate PRs)

1. **Publish guard** — cannot set workflow public if it references private agents
2. **Agent lock** — cannot set agent private if used by public workflow
