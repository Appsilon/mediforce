---
status: living
audience: everyone
last_reviewed: 2026-08-19
---

# Mediforce

Mediforce is a single-tenant, on-prem-capable workflow + agent orchestration
platform for pharma. This document is the glossary — canonical names for the
concepts. **Not a spec, not implementation guide.**

## Language

### Deployment shape

**Deployment**:
A single running Mediforce installation. Typically dedicated to one customer
(single-tenant). Contains many Namespaces.
Each environment — Appsilon's own production instance, staging, and each
per-customer instance — is a **separate Deployment** with its own database,
Users, and Namespaces. They are **peers, not tiers of one installation**: a
Workflow does not "promote" from staging to production, it is registered or
imported into each Deployment independently.
_Avoid_: "environment" as a synonym for a slice of one Deployment (it isn't —
each is a whole Deployment), and "the instance" unqualified when more than one
Deployment is in play.

**Namespace** *(canonical domain term; Workspace is the UI/storage term per ADR-0001)*:
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
_Avoid_: "Workflow" used loosely for one version (= Workflow Definition) or
for one execution (= Workflow Run).

**Workflow Definition**:
One versioned spec of a Workflow — the JSON content with steps, transitions,
declared roles, env, optional git workspace. **Trigger-free** (ADR-0011,
Issue #932): the Definition no longer declares triggers. Versioned (integer),
immutable once created. Belongs to one Namespace. Has
`visibility: public | private` on the parent Workflow — `public` discoverable
read-only across Namespaces, `private` members-only. The runnable artifact:
a Workflow Run is instantiated from one specific Workflow Definition (version).
_Avoid_: Process Definition (legacy schema name, replaced by Workflow
Definition), conflating with the parent Workflow.

**Workflow Run**:
One execution of a Workflow Definition. Tracks current step, status,
accumulated variables, trigger payload and trigger context, total cost,
deleted/archived flags.
_Avoid_: "Workflow Instance" (briefly proposed but inconsistent with the
project's "Run" vocabulary), "Process Instance" (legacy code term),
"Workflow" alone (ambiguous — Definition or Run?).

**Dry Run**:
A Workflow Run executed with `dryRun` set, in which **every** `agent` and
`script` step is swapped for the mock plugin. The graph, transitions, gates,
and human steps execute for real; only the expensive agent/script work is
faked. It answers *"is the workflow structured as I intended?"* — never *"does
the agent do what I want?"*, which only a real Run answers.
_Avoid_: `workflow register --dry-run` (that is **schema validation** of a
definition, not a Run — it executes nothing), and "test run" (unclaimed term;
the canonical name is Dry Run).

**Workflow readiness check** *(pre-run, static)*:
The static check run before a Run starts: missing container image, missing
Secret, low model credits, unknown model — each reported with a fix action.
Distinct from a **Dry Run**: readiness inspects the Definition without
executing anything; a Dry Run executes the graph.
_Avoid_: "validation" (that is schema-shape checking, a third, earlier gate).

**Trigger** *(detached mutable resource — ADR-0011)*:
What causes a Workflow to run, or makes it hand-startable. Three live kinds:
`manual` (a person starts a Run), `webhook` (an inbound HTTP call starts a Run),
`cron` (a schedule starts Runs). `event` is a reserved fourth kind with no
runtime yet. A Trigger is a **first-class mutable** resource keyed by
`(Namespace, Workflow, trigger name)`, stored on the unified `triggers` table
and attached to a Workflow **independently of its immutable Workflow Definition**
— managed like a Secret: added, toggled, retimed, and imported/exported without
registering a new Definition version. The Definition carries no triggers
(Issue #932).
_Avoid_: treating a Trigger as part of the Workflow Definition (it isn't — they
are detached resources), or conflating it with the **Trigger Payload** on a
Workflow Run (the data a firing hands the Run).

**Trigger Input** *(contract; on the Workflow Definition — `triggerInput`)*:
The **total, trigger-agnostic input contract** a Workflow declares — the named,
typed fields a firing must supply, regardless of which Trigger kind fires. Every
firing is validated against it: declared fields are required/typed, undeclared
fields are **rejected** (strict), and an empty/absent contract means the payload
must be **empty**. Opaque un-enumerable input (a proxied third-party JSON body)
is declared as a single field of `object` type. A field's `default` is part of
the contract, not of the manual form: it is filled in for every firing that
omitted the field, on every path, so a `required` field with a `default` is
satisfiable by a payload-less cron row.
_Avoid_: treating `triggerInput` as webhook-body-only or manual-only; using
**Trigger Context** to carry declared input.

**Trigger Payload** *(runtime; on a Workflow Run)*:
The **validated, trigger-agnostic** input a firing hands the Run — the caller's
fields plus the contract's defaults for the ones they omitted. It conforms to
the Workflow's **Trigger Input** contract and is read by Steps as
`${triggerPayload.<field>}` no matter which Trigger fired.
_Avoid_: putting transport metadata (HTTP headers, cron `firedAt`) on it — that
belongs on **Trigger Context**.

**Trigger Context** *(runtime; on a Workflow Run)*:
A reserved, **trigger-specific** escape hatch holding the transport metadata of
a firing (webhook `headers`/`query`/`method`/`path`, cron `firedAt`/`schedule`).
Webhook credential headers — `authorization`, `proxy-authorization`, `cookie`,
and `x-api-key` — are stripped before the remaining headers are persisted.
Steps that read `${triggerContext.*}` knowingly re-couple to a Trigger kind.
_Avoid_: routing declared workflow input through it — declared input is **Trigger
Payload**.

**Workflow Step** *(config; static)*:
A node in a Workflow Definition's graph. Defines `executor: human | agent |
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
executor (form submission, agent envelope, script envelope, gate decision).

**Variables**:
Accumulated outputs across all completed Step Executions of one Workflow Run.
The carry-forward state used to resolve `${steps.stepId.output.key}`
in subsequent steps and transitions.

**Artifact** (`CoworkSession.artifact`):
Structured deliverable that a human and an agent build collaboratively across
the turns of a Cowork Session. **Not** the same as Output or Variables —
finalized artifact is promoted to Output only when the cowork step completes.

**Output Files** (per Step Execution):
Files a Step Execution leaves behind alongside its Output (reports, exports,
generated documents) — preserved per Workflow Run on success and failure
alike, listable and downloadable by Run members (UI + CLI).
_Avoid_: Artifact (= Cowork Session deliverable), "deliverable"/`deliverableFile`
(legacy single-file mechanism), conflating with Output (= the structured result;
Output Files are its file siblings).

### Agent + human work

**Agent Run**:
The execution of one `agent`-type Step inside a Workflow Run. An autonomous
(L0–L4) attempt by one Agent (the template the Step's `agentId` resolves to)
to produce the Step's Output. Belongs to the workflow domain — not an
agent-side concept. Result: an Agent Output Envelope. Immutable once created.
_Note_: Autonomy levels (L0–L4) are an agent-only concept. Script steps
have no autonomy level — they are deterministic and auto-applied.

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

**Human actions** *(UI label)*:
The task inbox page listing all pending Human Tasks for the current user. Navigating
to a task item deep-links directly to the owning Workflow Run Step view (not a
separate task detail page). Previously labelled "New actions".
_Avoid_: using "task inbox" or "task detail" for the unified step view — the step
view is the canonical surface for human work, not a standalone task page.

**Handoff**:
Structured escalation from an Agent Run to a human (low confidence, error,
explicit escalation). Distinct from Human Task — Handoff has agent context,
question, resolution. Lifecycle: `created → acknowledged → resolved`.

### Plugin / Skill / MCP

**Plugin** *(runtime strategy)*:
A pluggable Step executor. Agent plugins are LLM-driven; script plugins are
deterministic. Plugins produce an Output; autonomy remains a workflow concern.
_Avoid_: conflating with Skill — Plugin is the runtime; Skill is data.

**Skill** *(code payload)*:
A code artifact (script or git repo) consumed by an agent at spawn time
(e.g. Claude Code loads it into the container).
_Avoid_: Conflating with Plugin — Plugin is the runtime; Skill is data.

**Agent**:
A reusable, mutable agent configuration: system prompt plus MCP server
bindings. Workflow Steps reference Agents; one Agent can power many Steps and
is not versioned today.
_Avoid_: Agent Definition (legacy code term; there is no versioned definition).
_Note_: 
Agent: only `systemPrompt` reaches the prompt (as `agentIdentityPrompt`), and
Skills are step-level (`step.agent.skillsDir`).

**MCP Server**:
External tool host (stdio or HTTP) accessible to an agent via Model Context
Protocol. Attached to an Agent via Agent MCP Binding; narrowed
per-step via Step MCP Restriction (subtractive).

**Tool Catalog Entry**:
Admin-curated stdio MCP server definition that agents reference by `catalogId`
(prevents inline RCE). Namespace-scoped.

### Identity / auth

**User**:
A human or service account authenticated to a Deployment.

**Session**:
A server-side record proving a User is currently signed in. Revocable
immediately.
_Avoid_: "JWT" (we explicitly chose database sessions, not JWT).

**Membership** *(workspace governance level)*:
The kind of seat a User holds inside one Workspace: `owner | admin | member`.
Owners can delete the Workspace and
manage other owners; admins can manage members and workspace settings; members
can use the Workspace.
_Avoid_: "Role" alone — that's overloaded with process-domain roles below.

**Roles** *(process-domain, plural)*:
Functional roles a User holds for workflow purposes — e.g. `reviewer`, `PI`,
`approver`. Free-form strings; there is no fixed vocabulary. A Role is held
**within one Workspace** and optionally narrowed to a single Workflow
([ADR-0019](docs/adr/0019-workspace-scoped-roles.md)); an unnarrowed grant
covers every Workflow in that Workspace. Roles drive task assignment, Step
access (`allowedRoles`), and notification targeting.
_Avoid_: confusing with Membership. Both are per-Workspace and both are called
"role" in the schema — Membership (`workspace_members.role`) governs who
administers the Workspace, Roles (`user_roles.role`) describe workflow
function.
_Note_: Roles are granted from the **Roles** table in workspace settings
(separate from the members table's **Membership** column, which is a different
thing), from the CLI (`mediforce namespace set-member-roles`) or over the API
(`PUT /api/namespaces/:handle/members/:uid/roles`), read back
(`mediforce namespace list-members`, `GET /api/users/members`), and enforced on
task claim and complete against the run's pinned Workflow Definition.

**Caller Identity** *(per-request authorization subject)*:
The authorization subject resolved for one request: either a signed-in User
with Workspace memberships or a system actor.
_Avoid_: conflating with User (the human/account) or Session (the sign-in
record) — Caller Identity is the per-request derivative used for scoping.

**Account linking** *(by verified email)*:
Attaching a new sign-in provider (e.g. Google) to an existing User when the
provider asserts the **same verified email**.

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
Secrets scoped to one Workflow across all its Definition versions. Wins over a
Namespace Secret with the same key.

### Evaluation domain

*(Layered model and system-of-record split defined in
[ADR-0007](docs/adr/0007-llm-evaluation-observability.md). Score / Eval
Dataset / Eval Run are reserved canonical names; their detailed design is
deliberately deferred until tracing ships.)*

**Trace**:
The telemetry record of one Agent Run's execution — a tree of spans (LLM
calls, tool invocations) carrying model, token, latency and correlation
attributes. Lives in an external, per-deployment trace store — **not** a
platform entity. Whether prompt/completion content is included is a
per-deployment switch (off by default in production).
_Avoid_: confusing with **Agent Event** (transient runtime emission,
discarded after the envelope is built) and **Audit Event** (the compliance
ledger). A Trace is operational telemetry.

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

**Eval Dataset** *(reserved; design deferred)*:
A curated set of golden / regression cases (input → accepted output) frozen
from selected production Agent Runs. Namespace-scoped platform entity.
_Avoid_: "Dataset" alone (collides with generic data-engineering usage),
"Benchmark" (implies public/academic suites).

**Eval Run** *(reserved; design deferred)*:
One execution of an Eval Dataset against a configuration (model, prompt,
agent variant), producing Scores and a champion-vs-challenger comparison.
Platform entity; fits the existing Run family (Workflow Run, Agent Run).
_Avoid_: "Experiment" (vague, collides with nothing but explains nothing).

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
  0..N **Human Tasks** attached, and produces 0..N **Output Files**.
- An **Agent Run** may produce 0..N **Handoffs**.
- An **Agent** has many **Agent MCP Bindings** (per server) and
  many **Agent OAuth Tokens** (per server).

## Flagged ambiguities

- **"Is my workflow working?"** names four checks: schema validation asks
  whether the Definition is legal; readiness asks whether dependencies are
  available; a Dry Run executes the graph with agent/script work mocked; a Run
  tests real behaviour. Only the Run answers whether the work is good.
- **Generated Files vs Output Files**: Generated Files are git-provenance paths
  changed by a Step. Output Files are preserved, downloadable deliverables.
  Neither is a Cowork Artifact.
- **L0 vs L2 with `result: null`**: Both allow null result. L0 = Silent
  Observer (annotations only, no decision attempted). L2 = Informed Agent
  (decision made, but confidence below threshold → null + fallback path).
  Their shapes can match; their semantics do not.
