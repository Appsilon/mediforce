---
status: accepted
audience: engineers
last_reviewed: 2026-10-07
---

# ADR-0025: A Skill is a Namespace resource an Agent owns, not something a Workflow carries

**Date:** 2026-10-05
**Deciders:** Krystian Zieliński
**Epic:** [#1458](https://github.com/Appsilon/mediforce/issues/1458) — Skill Catalog

#1460 builds the stored object and its API/CLI, #1461 the Agent → Skill
binding, #1462 the delivery to the container, #1463 the catalog UI.

## Context

Today a skill reaches an agent only through the **Workflow Definition**: a
Step names `agent.skillsDir` + `agent.skill`, and the folder comes from the
workflow's `externalSkillsRepo` (git, pinned to a commit), from the text files
it carries as `artifacts` (256 KB in total), or from local disk. The runtime
treats that folder in two ways at once. The named skill's `SKILL.md` is pasted
into the prompt (`buildPrompt`), and the folder's parent is mounted read-only at
`/plugin` and passed as `claude --plugin-dir /plugin`, so Claude Code also
discovers every other skill beside it natively, `references/` included.

So a user who wants to give an agent a skill has to own a git repository or
edit a workflow. The Tool Catalog already made the opposite move for MCP
servers: an Agent's `mcpServers` bindings name namespace-scoped catalog
entries, and a Step gets them through `step.agentId`
(`resolveMcpForStep`). Skills have no equivalent.

[ADR-0003](./0003-remove-firebase-storage.md) deleted an earlier
"uploaded skills" feature (`AgentDefinition.skillFileNames`). That feature
concatenated uploaded files into the system prompt, nobody used it, and its
bytes lived in Firebase Storage. This ADR does not reverse that deletion. What it
adds is a different object: a structured Claude Code skill folder, stored in
Postgres, which Claude Code loads natively.

Terms (**Skill**, **Step skill**, **Agent**, **Namespace**, **Step
Fingerprint**) are defined in [`CONTEXT.md`](../../CONTEXT.md).

## Decision

### 1. A Skill is a folder of text, keyed on `(namespace, id)`

A Skill holds a `SKILL.md` at its root and any other **text** files beside it:
`references/`, `scripts/`, `templates/`, more `.md`. `SKILL.md` must open with
frontmatter carrying `name` (kebab-case) and `description`.

- **`id` is the frontmatter `name`.** Claude Code resolves a skill by its
  directory name and expects it to equal `name`, so the frontmatter is the one
  source and the platform never asks for a second identifier. The id is fixed
  at create; an edit that changes `name` is refused. A rename is a new Skill.
- **`description` is required** because it is what Claude Code reads to decide
  whether to load the skill (decision 5).
- **Paths follow `WorkflowArtifactSchema`**: relative, forward slashes, no
  empty, `.` or `..` segment. The whole Skill is capped at 256 KB
  (`WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES`), the same bound a workflow's carried
  files already live under.
- **Binary files are out of scope for v1.**

### 2. Stored as a Postgres row, files as `jsonb`

One row per Skill: `namespace`, `id`, `name`, `description`, `visibility`,
`files jsonb` (an array of `{ path, contents }`), and a content hash computed
over the files.

A `BlobStore` exists for task attachments (ADR-0003). It is not used here.
Attachments are large and streamed, while a Skill is at most 256 KB of text and
is read whole on every step. A single row keeps content, hash and visibility in
one transaction, and at this size it costs `pg_dump` nothing. If binary assets
arrive later, they can go to the `BlobStore` without changing what a Skill is.

### 3. Visibility is `private` or `public`, as for Agents

A `private` Skill is visible to its Namespace's members. A `public` one is
visible to everyone in the Deployment. The rule for which Agent may hold which
Skill follows from that:

| Agent | May hold |
| --- | --- |
| `private` | its own Namespace's Skills, and any `public` Skill |
| `public` (including built-in agents, which have no Namespace) | `public` Skills only |

A `private` Skill of another Namespace is never reachable. The rule is checked
when an Agent is saved and when a Skill changes:

- an Agent cannot be made `public` while it holds a `private` Skill;
- a Skill cannot be made `private` while a `public` Agent, or an Agent in another
  Namespace, holds it.

Making a Skill `public` publishes its content to anyone who runs an Agent that
holds it, just as a public Agent's `systemPrompt` is published today.

### 4. The Agent owns its Skills; a Step gets them only through `step.agentId`

`AgentDefinition.skills` is a list of `(namespace, id)` references, not bare
ids, because a `private` Agent may hold a `public` Skill from another Namespace
and two Namespaces may each have a Skill with the same id. An Agent's Skills
must have distinct ids, since they become sibling directories in one plugin
folder (decision 6).

**A Skill resolves in the Namespace its reference names**, not in the
Workflow's. This deliberately differs from MCP catalog lookups, which resolve
in the Workflow's Namespace (`execute-agent-step.ts`): those make the same
Agent behave differently in each Namespace it runs in, while a Skill reference
always means the same Skill.

Workflow Definitions never name Skills. There is no step-level narrowing in
v1, so a Step cannot switch off one of its Agent's Skills.

### 5. A Skill is offered, not imposed

An Agent's Skills are delivered as Claude Code skills and loaded by the model
when a Skill's `description` fits the task. Nothing is pasted into the prompt.
The Step skill (`step.agent.skill`) keeps its existing behaviour and is always
in the prompt. To make an Agent always use one of its Skills, its
`systemPrompt` says so, for example "use the `sdtm-mapping` skill".

This keeps an Agent with many Skills from paying for all of them on every
prompt, and it is the mechanism ADR-0003 removed that we are not bringing back.

### 6. Delivery: a content-hashed Claude Code plugin folder, Claude Code only

At run time the Agent's Skills are written to a plugin folder on the host. The
folder is named by a hash of the Skills' content, so identical Skill sets share
one folder and concurrent Steps cannot clobber each other. It is mounted through
the existing chain: `pluginDir` → `/plugin` (read-only) → `--plugin-dir`.

When the Step also has a Step skill folder (`skillsDir`), the two are merged
into one plugin folder. **The Step skill wins on a name clash**; otherwise every
skill from both sources is visible. The Step skill is the more specific choice,
and the Workflow Definition that carries it is versioned.

**Claude Code agents only in v1.** OpenCode agents ignore an Agent's Skills,
and the Agent form says so when its runtime is OpenCode. _Amended 2026-10-07
([#1477](https://github.com/Appsilon/mediforce/issues/1477)): OpenCode agents
load the same plugin folder from the same `/plugin` mount, through
`skills.paths` in `opencode.json`; the form warns only for runtimes that load
neither._ Delivery assumes the
worker shares the host `/tmp` with the step container, as the git skills cache
already does. Shipping Skill files to a remote worker over Redis is not in v1.

### 7. Editable rows, no versions; audit carries the content hash

A Skill is edited in place and has no version history in v1, the same as an
Agent. An edit takes effect on the next Step that runs. Deleting a Skill is
refused while any Agent holds it. The refusal lists the holding Agents the
caller can see and counts the rest. A cascading delete would silently change
other Namespaces' Agents. Deleting a Namespace is refused on the same ground: while
an Agent that survives it holds one of its Skills.

Every agent Step Execution records `(namespace, id, contentHash)` for each Skill
it was offered. Under decision 5 the record says what was *available* to the
step, not what the model chose to open.

The **Step Fingerprint** ([ADR-0023](./0023-step-evaluation.md)) includes the
Agent's Skills: their references and content hashes, folded into the existing
`skill` component. **A Step whose Agent holds no Skills keeps the Fingerprint it
has today.** Adding a new component would change every existing Fingerprint and
make every Step Qualification stale, so the change only shows up for Steps that
actually gain Skills. Editing a held Skill makes a qualification stale, which
is the correct outcome. If validation reviewers need to pin a Skill version,
immutable versions can be added later.

### 8. Writes are gated like Agents

Creating, editing, deleting, and changing the visibility of a Skill require
workspace write on the Skill's Namespace (`assertNamespaceWrite`), the same gate
as Agents and Tool Catalog entries. There is no admin-only gate: a Skill executes
nothing by itself, and it does nothing until an Agent someone can already edit
holds it.

## Considered options

- **Resolve in the Workflow's Namespace, as MCP does.** Rejected: a public
  Agent would need a same-id Skill in every Namespace that runs it, and would
  behave differently in each. That contradicts the Agent owning its Skills.
- **Skills private to their Namespace, with public Agents unable to hold any.**
  Rejected: built-in agents are public and have no Namespace, so they could
  never carry a Skill.
- **A separate Deployment-wide Skill scope for built-in agents.** Rejected:
  `public` already covers it without a third scope.
- **Paste every Skill into the prompt.** Rejected (decision 5).
- **Files in the `BlobStore` or on disk.** Rejected for v1 (decision 2).
- **Immutable Skill versions.** Deferred. The content hash in the audit and in
  the Fingerprint already shows which version ran.

## Out of scope for v1

Binary assets; immutable versions and pinning; step-level narrowing; OpenCode
support; Redis transfer of Skill files to a worker that does not share `/tmp`.
