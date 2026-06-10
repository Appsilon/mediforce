# Mediforce

Mediforce is a single-tenant, on-prem-capable workflow + agent orchestration
platform for pharma. This document is the glossary — canonical names for the
concepts. **Not a spec, not implementation guide.**

## Language

### Deployment shape

**Deployment**:
A single running Mediforce installation. Typically dedicated to one customer
(single-tenant). Contains many Namespaces.

**Namespace** *(today canonical; rename to Workspace proposed in ADR-001)*:
An isolated scope of work inside a Deployment. Owns workflow definitions,
workflow runs, agents, OAuth providers, secrets, tool catalog,
cowork sessions. Identified by a URL-safe `handle`. Two types: `personal`
(auto-created per user, linked via `linkedUserId`) and `organization`
(multi-member, shared — e.g. a department inside the customer tenant).
_Avoid_: Workspace (UI term in transition — see note below), Tenant (= the
whole Deployment, not an isolated scope inside it).

**Handle**:
URL-safe identifier for a Namespace (e.g. `acme-onco-trial`). Globally unique
inside a Deployment. Used in URL paths (`/{handle}/…`) and as Namespace's
storage key.

### Workflow domain

**Workflow**:
A named, reusable process. Identified by `(namespace, name)`. Owns many
versioned **Workflow Definitions**, a default-version pointer, visibility,
archive state. The named thing users create, edit, share, and run.
_Code:_ no explicit `Workflow` schema — encoded as `(namespace, name)` tuple
with the `WorkflowDefinitionGroup` query-result type aggregating its versions.
_Avoid_: "Workflow" used loosely for one version (= Workflow Definition) or
for one execution (= Workflow Run).

**Workflow Definition**:
One versioned spec of a Workflow — the JSON content with steps, transitions,
triggers, declared roles, env, optional git workspace. Versioned (integer),
immutable once created. Belongs to one Namespace. Has
`visibility: public | private` on the parent Workflow — `public` discoverable
read-only across Namespaces, `private` members-only. The runnable artifact:
a Workflow Run is instantiated from one specific Workflow Definition (version).
_Avoid_: Process Definition (legacy schema name, replaced by Workflow
Definition), conflating with the parent Workflow.

**Workflow Run** *(today's `ProcessInstance` — rename to `WorkflowRun` proposed)*:
One execution of a Workflow Definition. Tracks current step, status,
accumulated variables, trigger payload, total cost, deleted/archived flags.
**"Run" is the canonical term** — used everywhere in the UI, URLs
(`/workflows/{name}/runs/{runId}`), API routes (`/api/runs/{runId}`), schema
comments ("new runs", "archived runs", git branch `run/<runId>`), and
neighbour entities (`AgentRun`). The `ProcessInstance` schema name is
implementation legacy and renames to `WorkflowRun` in ADR-0001.
_Avoid_: "Workflow Instance" (briefly proposed but inconsistent with the
project's own "Run" vocabulary), "Process Instance" (legacy schema name
only), "Workflow" alone (ambiguous — Definition or Run?).

**Workflow Step** *(config; static)*:
A node in a Workflow Definition's DAG. Defines `executor: human | agent |
script | cowork | action`, optional autonomy level (agent steps),
allowed roles, verdicts, params.
_Avoid_: "Step" alone (ambiguous — config or runtime instance?).

**Step Execution** *(runtime; one attempt)*:
One attempt to execute one Workflow Step inside a Workflow Run. Captures
input, output, verdict, gate result, iteration number, error. Optionally has
0..1 Agent Run, 0..1 Cowork Session, 0..N Human Tasks attached.

### What an agent / human / cowork produces

**Output** (`StepExecution.output`):
Immediate result of one Step Execution. Polymorphic — shape depends on
executor (form submission, agent envelope, gate decision).

**Variables** (`ProcessInstance.variables`):
Accumulated outputs across all completed Step Executions of one Process
Instance. The carry-forward state used to resolve `${steps.stepId.output.key}`
in subsequent steps and transitions.

**Artifact** (`CoworkSession.artifact`):
Structured deliverable that a human and an agent build collaboratively across
the turns of a Cowork Session. **Not** the same as Output or Variables —
finalized artifact is promoted to Output only when the cowork step completes.

### Agent + human work

**Agent Run**:
The execution of one `agent`-type Step inside a Workflow Run. An autonomous
(L0–L4) attempt by one Agent (the template the Step's `agentId` resolves to)
to produce the Step's Output. Belongs to the workflow domain — not an
agent-side concept. Result: an Agent Output Envelope. Immutable once created.

**Cowork Session**:
A real-time, human-in-the-loop session attached to a Step Execution where
executor=`cowork`. Modes: `chat` (text via SSE) or `voice-realtime` (OpenAI
Realtime). Has turns and an Artifact.
_Avoid_: "Cowork" as a standalone noun without context (`Cowork Session`,
`Cowork Step` are the precise terms).

**Conversation Turn**:
A single message in a Cowork Session. Three role-discriminated subtypes:
`human`, `agent`, `tool` (MCP tool execution result).

**Human Task**:
Work item assigned to a human role inside a Workflow Run. Created when
`executor=human` or as L3 agent-review. Has soft claim (`assignedUserId: null`
visible to all role-matching users until claimed).

**Handoff**:
Structured escalation from an Agent Run to a human (low confidence, error,
explicit escalation). Distinct from Human Task — Handoff has agent context,
question, resolution. Lifecycle: `created → acknowledged → resolved`.

### Plugin / Skill / MCP

**Plugin** *(runtime strategy)*:
A pluggable agent runtime implementation. Today: `claude-code`, `opencode`,
`script-container`, plus mocks. Each implements `BaseContainerAgentPlugin` and
declares roles (`executor`, `reviewer`). Registered in PluginRegistry.

**Skill** *(code payload)*:
A code artifact (script or git repo) consumed by an agent at spawn time
(e.g. Claude Code loads it into the container).
_Avoid_: Conflating with Plugin — Plugin is the runtime; Skill is data.

**Agent**:
A reusable agent the platform can run — Claude Code / OpenCode /
cowork-chat / voice-realtime / future runtimes. Bundles system prompt,
foundation model, MCP server bindings, skills (and, in the future, tools).
Referenced by a Workflow Step via `agentId`; the same Agent powers many
Steps across many Workflows. Single mutable document — **not versioned
today** (the agent IS the spec, one row per agent).
_Future:_ if we introduce versioning, an **Agent Definition** would emerge
as one versioned spec of an Agent (parallel to Workflow / Workflow Definition).
_Code:_ user-facing surface (UI, URL `/api/agents/*`, CLI `agent-*`) uses
"Agent". Schema (`AgentDefinitionSchema`), repository
(`AgentDefinitionRepository`), and ADR-0001 Postgres table name are legacy
artifacts from before this glossary entry was canonicalised — rename to
`Agent*` pending in a follow-up.

**MCP Server**:
External tool host (stdio or HTTP) accessible to an agent via Model Context
Protocol. Attached to an Agent via Agent MCP Binding; narrowed
per-step via Step MCP Restriction (subtractive).

**Tool Catalog Entry**:
Admin-curated stdio MCP server definition that agents reference by `catalogId`
(prevents inline RCE). Namespace-scoped.

### Identity / auth

**User**:
A human (or service account) authenticated to a Deployment. Identity owned by
the auth library (NextAuth tables `auth_users` + `auth_accounts` + `auth_sessions`
after ADR-0002). Mediforce-side fields live in `user_profiles`.

**Session**:
A server-side, DB-backed record proving a User is currently signed in. Carries
a `session_token` (cookie value), `user_id`, `expires`. Revocable
immediately by deleting the row.
_Avoid_: "JWT" (we explicitly chose database sessions, not JWT).

**Membership** *(workspace governance level)*:
The kind of seat a User holds inside one Workspace: `owner | admin | member`.
Stored on `workspace_members.membership`. Owners can delete the Workspace and
manage other owners; admins can manage members and workspace settings; members
can use the Workspace.
_Avoid_: "Role" alone — that's overloaded with process-domain roles below.

**Roles** *(process-domain, plural)*:
Functional roles a User holds inside one Workspace for workflow purposes —
e.g. `reviewer`, `PI`, `approver`. Stored on `workspace_members.roles` as
`text[]`. Drive `HumanTask.assignedRole` and `CoworkSession.assignedRole`
gating, and `WorkflowStep.allowedRoles` access control.
_Avoid_: confusing with Membership above. Roles are per-workspace today
(per-deployment in legacy Firebase custom claims; migrated to per-workspace
in ADR-0002).

**Deployment admin**:
A boolean on `user_profiles.deployment_admin`. The Deployment-wide
superuser bit (formerly Firebase custom claim `role: 'admin'`). Rare —
typically one sysadmin per Deployment. Cross-Workspace operational power.

**OAuth Provider Config** *(per-Namespace)*:
Authorization-server endpoint + credentials. GitHub / Google built-in; custom
OIDC supported.

**Agent OAuth Token** *(per Namespace + Agent + Server)*:
Persisted token used by one Agent to authenticate to one MCP
server. Two Agents needing GitHub connect twice — by design.

**Namespace Secret** *(broader scope)*:
Key-value secrets visible to all workflows in a Namespace. Resolved via
`{{SECRET:name}}` template at runtime.

**Workflow Secret** *(narrower scope)*:
Secrets scoped to one Workflow Definition. Wins over Namespace Secret if
same key exists (precedence).

### Evaluation domain

**Score**:
An external quality judgment attached to one Agent Run or one Workflow Run
(polymorphic subject). Three sources: deterministic check, LLM-as-judge,
human review. The unit of evaluation is the **Agent Run**; Workflow-Run-level
Scores arise only from production monitoring (e.g. a final human verdict) —
offline replay of whole workflows is explicitly out of scope.
_Avoid_: confusing with `AgentOutputEnvelope.confidence` — confidence is the
agent's **self-assessment**, a Score is an **external judgment**. Also avoid
"evaluation" for a single judgment (an evaluation is a process; a Score is
one data point).

### Audit / observability

**Audit Event**:
Immutable, human-readable log entry. Captures actor (user/agent/system),
action, basis (rule that triggered), input/output snapshot, entity context,
process+step context. The compliance backbone (21 CFR Part 11).

**Agent Event**:
Operational telemetry emitted during an Agent Run (status changes, custom
events). Distinct from Audit Event — Agent Event is internal; Audit Event is
the user-facing immutable log.

## Relationships

- A **Deployment** contains many **Namespaces**.
- A **Namespace** owns its **Workflows** (with their **Workflow Definitions**),
  **Workflow Runs**, **Agents**, **OAuth Providers**, **Secrets**,
  **Tool Catalog**.
- A **Workflow** has many versioned **Workflow Definitions**; its `visibility`
  controls cross-Namespace read access.
- A **Workflow Run** belongs to exactly one **Workflow Definition**
  (`name`+`version` identifies which version of which Workflow).
- A **Workflow Run** has many **Step Executions**.
- A **Step Execution** has 0..1 **Agent Run**, 0..1 **Cowork Session**,
  0..N **Human Tasks** attached.
- An **Agent Run** may produce 0..N **Handoffs**.
- An **Agent** has many **Agent MCP Bindings** (per server) and
  many **Agent OAuth Tokens** (per server).

## Flagged ambiguities

- **Namespace vs Workspace** *(active rename in flight)*: Code uses
  `namespace` everywhere — schema fields, repos, Firestore collection,
  Postgres columns (post-migration). UI uses "Workspace" in user-facing
  strings (placeholders, redirect paths, hook names). **Today's canonical
  domain term: `Namespace`.** ADR-001 proposes the inverse — flip to
  `Workspace` as the canonical user-facing term, with `namespace` retiring to
  a storage-level synonym at most. Decision deferred to ADR-001 review.
- **Process vs Workflow** *(legacy)*: `Process*` is legacy naming. `Workflow*`
  is the present canonical. Some repos still named `ProcessRepository`
  while managing `WorkflowDefinitions`; `processInstanceId` field name
  ubiquitous. ADR-001 renames at storage level only (column names);
  follow-up PRs rename repositories and types incrementally. New code
  uses Workflow.
- **Agent vs Agent Definition** *(legacy asymmetry)*: Canonical user-facing
  term is **Agent** (UI labels, URL `/api/agents/*`, CLI `agent-*`). Today
  there is no versioning — one mutable document per Agent. The schema
  (`AgentDefinitionSchema`) and repository (`AgentDefinitionRepository`)
  carry the "Definition" suffix as a historical artifact, mirroring the
  Workflow / Workflow Definition split that exists in the workflow domain
  because workflows really are versioned. Rename of schema + repo to
  drop the suffix is pending in a follow-up PR. If we ever introduce
  agent versioning, the suffix will earn its keep — see the **Agent**
  glossary entry.
- **Output vs Variables vs Artifact**: three distinct concepts, often
  confused. Output = one step's immediate result. Variables = accumulated
  outputs forwarded across steps. Artifact = collaboratively built
  deliverable inside a cowork session (promoted to Output only on cowork
  finalize). Keep the distinction in storage too.
- **Workflow visibility (`public` vs `private`)**: Defined in PR #346 — a
  `public` Workflow Definition is **read-discoverable from other
  Namespaces**; `private` is members-only. **Workflow Runs (runs) are
  always members-only**, regardless of the parent definition's visibility.
  Default changed to `private` later. Postgres needs same semantic — most
  natural: app-layer filter today, RLS policy `USING (namespace IN (member of)
  OR (table = workflow_definitions AND visibility = 'public'))` in the
  future RLS ADR. Resolved 2026-05-19: `public` stays a live cross-workspace
  feature — teams can publish, platform ships examples — no pharma-deployment
  disable. Access goes through an **explicit repo method**
  (`discoverPublicWorkflows()`); default `list()` stays workspace-scoped.
- **L0 vs L2 with `result: null`**: Both allow null result. L0 = Silent
  Observer (annotations only, no decision attempted). L2 = Informed Agent
  (decision made, but confidence below threshold → null + fallback path).
  Storage shape identical; semantics differ.
- **`workspace` name collision** *(resolved 2026-05-19)*: With the
  Namespace → Workspace rename proposed in ADR-001, the existing
  `WorkflowDefinition.workspace` field (git working-tree config) collides.
  Resolution: rename that field to **`gitWorkspace`**. The schema type
  `WorkflowWorkspaceSchema` becomes `WorkflowGitWorkspaceSchema`,
  `WorkflowWorkspace` type becomes `WorkflowGitWorkspace`.
- **Fail-proof repository scoping** *(resolved 2026-05-19, applies to
  ADR-001 implementation)*: Two invariants on every repo query:
  (1) workspace/namespace scoping enforced at the repo base class — caller
  cannot construct a query that crosses workspaces by accident;
  (2) soft-delete filter (`deleted_at IS NULL AND archived_at IS NULL`)
  enforced at the repo base class — caller cannot accidentally read
  tombstones. Both have explicit opt-out methods (`crossWorkspacePublic()`,
  `includeArchived()`, `includeDeleted()`) used only at audited call sites
  (admin, public workflow discovery, cleanup jobs). Postgres RLS in the
  later Phase 2 ADR adds belt-and-suspenders enforcement.
- **Retention policy** *(resolved 2026-05-19)*: Soft-delete is **forever**
  for now — no automatic hard-delete purge after N days. A later ADR may
  introduce retention windows if a customer asks. Operational implication:
  storage grows monotonically; partial indexes on `deleted_at IS NULL`
  keep query cost flat.
