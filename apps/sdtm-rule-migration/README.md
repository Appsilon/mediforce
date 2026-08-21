# sdtm-rule-migration

Verifies a CDISC CORE rule against SDTMIG v3.4 using the `sdtm-rule` and
`sdtmig-reference` skills, proposes YAML and mock-data fixes for human review,
then opens a PR against `Appsilon/core-contributor` on approval.

## Steps

| Step | Autonomy | Does |
|---|---|---|
| `verify-and-propose` | L3 | Applies the skills, writes a `proposedChanges` envelope (branch, PR title/body, file content). Pauses for review. |
| `open-pr` | L4 | On `approve`, publishes via GitHub MCP: `create_branch` → `push_files` → `create_pull_request`. |
| `done` | — | Terminal. |

`revise` loops back to `verify-and-propose` with the reviewer's comment. No PR
exists at that point, so revising is a cheap conversation rather than a
force-push.

## The control that matters

**GitHub MCP is disabled at the `verify-and-propose` step.** The agent that
proposes changes literally cannot reach the remote repository — it can only
write an envelope describing what it would do. Publishing is a separate step,
behind a human verdict, with its own autonomy level.

This is per-step MCP binding used as a real boundary, not a convention: the
proposing agent's inability to push is enforced by the platform, so "could this
step have written to the repo?" is answerable from the definition.

## Setup

Requires a GitHub App, an OAuth provider in the `appsilon` namespace, and a
connected AgentDefinition with the github MCP binding. Full one-time staging
setup: [`SETUP.md`](SETUP.md).
