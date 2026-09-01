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

**`getPlatformServices()` is the only composition root.** It wires repositories,
the workflow engine, the plugin registry and the action registry. It lives here —
not in `platform-ui`, whose `src/lib/platform-services.ts` is a re-export shim
scheduled for deletion.

## Testing

Handlers are directly unit-testable — no HTTP, no server. `./testing` provides
the doubles. Product features additionally need an L3 API E2E, which is what
proves the storage backend, middleware and auth actually agree; see
[`docs/testing/e2e-strategy.md`](../../docs/testing/e2e-strategy.md).
