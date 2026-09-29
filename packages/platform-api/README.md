# @mediforce/platform-api

The headless platform. Every mutation and query lives here as a framework-free
handler: `(input, scope) => Promise<output>`. No HTTP, no Next.js, no JSON.

This is the package that makes the UI, the CLI, agents and tests peers rather
than a hierarchy — they all call the same function. A handler that knew about
`NextRequest` would be reachable from exactly one of them.

## Entry points

| Export | Holds |
|---|---|
| `./handlers` | The business logic, one directory per domain |
| `./contract` | Zod input/output contracts, one file per domain |
| `./services` | `getPlatformServices()` — the composition root |
| `./repositories` | `CallerScope` construction and scoped data access |
| `./client` | `Mediforce` — typed client for server-to-server callers |
| `./auth`, `./errors`, `./runtime`, `./testing` | Auth helpers, `ApiError` types, runtime glue, test doubles |

## The shape

```
UI route adapter ─┐
CLI command ──────┼─► handler(input, scope) ─► repositories ─► Postgres
agent / MCP ──────┘
```

A handler receives already-parsed input and an already-authenticated
`CallerScope`. It never authenticates, never parses a request body, and never
formats a response — the adapter does that. Full rationale:
[`docs/reference/api-architecture.md`](../../docs/reference/api-architecture.md).

## Rules

**New mutations land here, not as Server Actions.** A handler plus a Zod
contract plus a route adapter. Server Actions can only be called over React RPC,
which forks the contract away from every other client
([ADR-0005](../../docs/adr/0005-headless-platform-api-ui-separation.md)).

**Authorization is the scope's job.** `CallerScope` carries the namespace and
role; data access is scoped through it rather than filtered afterwards
([ADR-0004](../../docs/adr/0004-scoped-data-access-authorization.md)). A handler
that queries broadly and trims the result later has already read data the caller
was not entitled to.

**A client-supplied namespace is a filter, never a grant.** Several list
wrappers take an optional `namespace` so a page can ask for the one workspace it
is showing. That argument arrives from the query string, so a wrapper narrows it
through `narrowToMemberships` rather than passing it to the raw repository on its
own — handing it straight through turns a narrowing parameter into a way to read
any workspace's private rows.

**Role checks live in the handler, never in the wrapper.** The wrapper answers
*may you see this row*; whether you may take an action is a per-action question
the wrapper has no way to ask. Both predicates for it are in
[`src/auth.ts`](src/auth.ts): `assertCallerIsNamespaceAdmin` for Membership, and
`assertCallerHoldsRole(caller, namespace, workflow, allowedRoles, directory)`
for the process-domain Roles of
[ADR-0019](../../docs/adr/0019-workspace-scoped-roles.md). Pass the workflow —
it is what lets a grant narrowed to one workflow be refused on another. All
three of the epic's verbs go through that one predicate: `act` via
`handlers/tasks/_role-gate.ts` (the step's `allowedRoles`), `run` and `edit` via
`handlers/workflows/_access-gate.ts` (the workflow's Access rows). A handler
that needs a fourth calls the predicate rather than writing a fifth check.

**The built-in roles are data, not a branch in the gate.** The four roles of
[ADR-0020](../../docs/adr/0020-built-in-roles-and-default-workflow-access.md)
reach the predicate the same way every other role does — by being written into
the lists it reads. `handlers/workflows/_seed-access.ts` does that on a
workflow's first version, together with the narrowed `workflow-manager` grant
that keeps the seeded `edit` list from refusing the author their own next Save.
`setWorkflowAccess` raises a restricted list to that floor on write, so the
storage a gate reads and the chips the tab locks are the same fact, and
`setNamespaceMemberRoles` re-establishes the owner's `workflow-manager` through
its full replace. Nothing in `auth.ts` knows these names, and nothing should: a
role that held authority the Access tab does not show would make the tab a
partial answer.

**Two handlers deliberately have no caller.** `previewJoinLink` and
`redeemJoinLink` ([ADR-0021](../../docs/adr/0021-workspace-join-links.md)) run
behind public routes: the join-link *token* is the authorization, so they must
never consult `scope.caller`, and the route builds a system scope for them
rather than resolving credentials that do not exist. Every other handler in
`handlers/join-links/` is an ordinary owner/admin surface behind
`assertCallerIsNamespaceAdmin`. The rule this bends — a handler reaches data
through `CallerScope` — is intact; the one it suspends is that a caller was
authenticated, and only these two may do that.

**Every Score goes through `recordScore`** (`handlers/scores/record-score.ts`),
which appends its `score.created` audit event. There is no generic Score write
route: Scores arrive from task completion (Control Mode 3 verdicts) and from a
person labelling an output for an Evaluator (`labelEvaluatorOutput`).

**Evaluation belongs to a Step, not a definition.** `handlers/evaluation/`
([ADR-0023](../../docs/adr/0023-step-evaluation.md)) keys every Brief, Evaluator,
Eval Case, Dataset version and MCP eval policy by `(namespace, workflowName,
stepId)` and reaches it through the one `scope.evaluation` wrapper. Reads need
only to see the workflow; writes need its `edit` verb (`_lib/evaluated-step.ts`).
An Evaluator check that cannot run comes back as `error`, never as a failed
output (`_lib/run-evaluator-check.ts`). Nothing here approves a `code` check's
source or labels an output on anyone's behalf: both record the person who did
it, and an API key must name them.

An Eval Run is driven by `driveEvalRun` (`_lib/drive-eval-run.ts`), which is
idempotent and moves trials only by conditional transitions — so the start
handler, the auto-runner (when a trial's run ends) and the heartbeat can all
call it without starting or scoring a trial twice. Claiming a trial names the
Workflow Run it creates, and a claim held past its lease — a driver that died
before creating that run, or mid-scoring — is taken over, skipping Evaluators
that already scored it; after three attempts the trial fails instead. A
cancelled Eval Run starts nothing more but is still driven until its in-flight
trials are scored. A trial's cost is its Agent Run — charged to the budget when
it is claimed for scoring — plus each LLM judge call, charged as it is made and
kept on the Score it produced (`_lib/model-prices.ts` prices those). An Eval
Run's report is computed from the Scores on read, never stored.

**Assistants share building blocks.** `src/assistant-core/` holds the pieces
the workflow editor assistant and the Evaluation Assistant both use
([ADR-0023](../../docs/adr/0023-step-evaluation.md) D14): one prompt audit event
per request, Zod registries turned into tool definitions, argument parsing that
tells the model what it sent, and the platform-tool runner that executes a call
as the caller and returns a refusal as a result (`needsAdmin`) instead of
throwing. Tools that change what the person is editing are *proposals* the
client applies; *platform* tools run here through `CallerScope`. The workspace
`OPENROUTER_API_KEY` check is `services/openrouter-key.ts`, since non-assistant
LLM calls need it too. The tool-calling loop itself is not shared yet: the
workflow assistant (`handlers/workflow-assistant/ask-workflow-assistant.ts`)
still runs its own, interleaved with its graph-completeness gates and truncation
salvage. The cowork chat (`handlers/cowork/`) is a separate OpenRouter loop and
does not use the core.

**`getPlatformServices()` is the only composition root.** It wires repositories,
the workflow engine, the plugin registry and the action registry. It lives here —
not in `platform-ui`, whose `src/lib/platform-services.ts` is a re-export shim
scheduled for deletion.

## Testing

Handlers are directly unit-testable — no HTTP, no server. `./testing` provides
the doubles. Product features additionally need an L3 API E2E, which is what
proves the storage backend, middleware and auth actually agree; see
[`docs/testing/e2e-strategy.md`](../../docs/testing/e2e-strategy.md).
