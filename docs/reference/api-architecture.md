---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Mediforce API code architecture

How an API request is served: which package holds what, and where the boundary
between framework code and business logic sits. Companion to
[`architecture.md`](../concepts/architecture.md) — that doc covers the domain
(Steps, Processes, Autonomy levels), this one covers the runtime shape of the
code.

## The split

**Handler** — `(input, scope) => Promise<output>`. Framework-free: no HTTP, no
Next.js, no JSON, no Postgres. Receives already-parsed input and an
already-authenticated, scoped data-access bag. Throws `HandlerError`. Lives in
`packages/platform-api/src/handlers/<domain>/`.

**Adapter** — translates between the two worlds. Resolves the caller, parses the
request into the input shape, builds `scope`, calls the handler, serializes the
result, maps thrown errors to HTTP status codes. Lives in
`packages/platform-ui/src/lib/route-adapter.ts`.

Ports-and-adapters: the handler is the application core, the Next.js route is
one presentation layer. Adding a consumer — standalone HTTP server, MCP tool,
in-process CLI call — means wrapping the same handler from outside. The handler
file does not change.

## The pieces

| Concept | Package | File / dir | Purpose |
|---|---|---|---|
| **Contract** | `@mediforce/platform-api` | `contract/<domain>.ts` | Zod input + output schemas. The API surface. |
| **Handler** | `@mediforce/platform-api` | `handlers/<domain>/<name>.ts` | Pure function `(input, scope) => output`. Throws `HandlerError`. |
| **Generic read adapters** | `@mediforce/platform-api` | `handlers/_generic.ts` | `listAdapter` / `getByIdAdapter` — bind a contract straight to a scope-bound repo, no handler file. |
| **Scope** | `@mediforce/platform-api` | `repositories/create-caller-scope.ts` + `authorized-*-repository.ts` | Per-request data-access bag with namespace authorization baked in ([ADR-0004](../adr/0004-scoped-data-access-authorization.md)). |
| **Adapter** | `@mediforce/platform-ui` | `lib/route-adapter.ts` | `createRouteAdapter(schema, fromRequest, handler, options?)` → Next.js route fn. |
| **Route file** | `@mediforce/platform-ui` | `app/api/<path>/route.ts` | ~15 LOC. Imports contract + handler, wires the adapter. |
| **Client (typed)** | `@mediforce/platform-api/client` | `Mediforce` class | Browser, Node and CLI consume the same contract; parses responses through the output schemas. |

## Request pipeline

`createRouteAdapter` runs these in order, short-circuiting on the first failure:

1. **Auth.** `resolveCallerIdentity` (`lib/api-auth.ts`) reads `X-Api-Key` or
   the NextAuth session cookie → `CallerIdentity`. Failure → `401`. This runs
   *before* input parsing, so an unauthenticated request with a malformed body
   gets `401`, not `400`. `src/proxy.ts` separately gates `/api/*` for
   credential presence ([ADR-0002](../adr/0002-firebase-auth-to-nextauth.md));
   both layers stay.
2. **Input.** `inputFromRequest(req, ctx)` builds a raw object from body, query
   and path params (`ctx.params` is a promise on dynamic routes); the Zod schema
   validates it. Failure → `400`, first issue as `error.message`, all issues in
   `error.details`.
3. **Scope.** `createCallerScope(services, caller)` → `CallerScope`.
4. **Handler.** Invoked as `(input, scope)`.
5. **Response.** Output → `NextResponse.json(output)` at `200`
   (`options.successStatus: 201` for routes that create a resource).
   `HandlerError` → its `toEnvelope()` at its `statusCode`. A `ZodError`
   escaping a handler → `400`. Anything else → `500`, full error logged.

Test seams: `options.resolveCaller` and `options.buildScope` substitute auth and
services. Production code never sets either.

A route file is mechanical — `app/api/tasks/[taskId]/claim/route.ts` in full:

```ts
import { createRouteAdapter } from '@/lib/route-adapter';
import { claimTask } from '@mediforce/platform-api/handlers';
import { ClaimTaskInputSchema, type ClaimTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export const POST = createRouteAdapter<
  typeof ClaimTaskInputSchema,
  ClaimTaskInput,
  unknown,
  RouteContext
>(
  ClaimTaskInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  claimTask,
);
```

Trivial reads skip the handler file entirely — the route wires `listAdapter` or
`getByIdAdapter` against the scope-bound repository (ADR-0004 Decision-10).
Handlers exist only where there is genuine logic: cross-entity loads, role /
ownership / state checks, or shape transforms.

## Errors

`HandlerError(code, message, details?)` is the only throwable. `code` is one of
`unauthorized`, `forbidden`, `not_found`, `validation`, `payload_too_large`,
`precondition_failed`, `conflict`, `rate_limited`, `internal`. `statusCode`
derives from `code`; `toEnvelope()` produces the wire shape
`{ error: { code, message, details? } }`. Subclasses — `ForbiddenError`,
`NotFoundError`, `PreconditionFailedError`, `ConflictError`, `ValidationError`,
`PayloadTooLargeError` — exist for the codes with real throw sites: narrower
throw, identical envelope. `internal` has no subclass on purpose; the adapter
emits it for anything uncaught. See
[ADR-0005](../adr/0005-headless-platform-api-ui-separation.md).

## A handler, in full

```ts
// contract/tasks.ts
export const ClaimTaskInputSchema = z.object({ taskId: z.string().min(1) });
export const ClaimTaskOutputSchema = z.object({ task: HumanTaskSchema });

// handlers/tasks/claim-task.ts
export async function claimTask(
  input: ClaimTaskInput,
  scope: CallerScope,
): Promise<ClaimTaskOutput> {
  if (scope.caller.kind !== 'user') {
    throw new ForbiddenError('Cannot claim as system actor');
  }
  const task = await loadOr404(scope.tasks.getById(input.taskId), 'Task not found');
  if (task.status !== 'pending') {
    throw new PreconditionFailedError(`Cannot claim a ${task.status} task`, {
      taskId: input.taskId,
      currentStatus: task.status,
    });
  }
  const claimed = await scope.tasks.claim(input.taskId, scope.caller.uid);
  await scope.system.audit.append({ /* … see ADR-0005 audit bridge … */ });
  return { task: claimed };
}
```

Typed input, typed output, typed errors, scoped data access. Nothing else.

## Boundaries

Never in a handler:

- `NextRequest`, `NextResponse`, `cookies()`, any Next.js import.
- Postgres or Drizzle imports.
- Raw repositories from `@mediforce/platform-core/interfaces` — the handler gets
  `CallerScope` only. `no-raw-repo-imports.test.ts` fails CI otherwise (ADR-0004
  Decision-9).

Never in an adapter:

- Business logic, state-machine validation, audit emission.

Two escape hatches, both exported from `route-adapter.ts`: `defaultBuildScope`
and `jsonErrorResponse`, so the rare binary route that cannot compose through
`createRouteAdapter` still runs the identical auth + scope pipeline and returns a
byte-identical error envelope.

## Testing layers

- **Contract** — Zod schema invariants.
- **Handler** — pure function against `InMemory*Repository` from
  `@mediforce/platform-core/testing`. No mocks.
- **Adapter** — wiring and error mapping, sampled per route.
- **Cross-layer** — client ↔ adapter ↔ handler ↔ repo, in-process via loopback
  `apiFetch`. One per major feature.
- **Structural guards** — `api-boundaries.test.ts` (platform-ui),
  `no-raw-repo-imports.test.ts` (platform-api).

Level model and what a feature must ship:
[`e2e-strategy.md`](../testing/e2e-strategy.md).

## Where decisions live

- [ADR-0004](../adr/0004-scoped-data-access-authorization.md) — `CallerScope` and
  `Authorized<Entity>Repository`; why authorization moved out of handlers into
  the data-access boundary.
- [ADR-0005](../adr/0005-headless-platform-api-ui-separation.md) — error
  envelope, status mapping, response shape, Server Action policy, audit bridge.
- [`archive/headless-migration.md`](../archive/headless-migration.md) —
  historical record; the migration concluded in PR #534 (2026-05-31).

Domain terms (Workflow Run, Human Task, Cowork Session, …) are defined in
[`CONTEXT.md`](../../CONTEXT.md). Handler, adapter, scope and contract are
code-architecture vocabulary and deliberately live here instead.
