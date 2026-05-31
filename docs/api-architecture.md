# Mediforce API code architecture

How API code is organised across packages, what the layers do, and why
the headless platform separates them this way. Companion to product-level
[`architecture.md`](./architecture.md) (which documents Steps, Processes,
Autonomy levels — the *what*), this doc covers the *how*: the runtime
shape of code that serves an API request.

> Living doc. Architecture decisions land in
> [`docs/adr/`](./adr/); this file describes the current implementation so
> contributors can navigate it without re-deriving the pattern. Update
> alongside ADR changes.

## The split

Two layers with different concerns:

- **Handler** — pure, framework-free function. `(input, scope) => Promise<output>`.
  Knows nothing about HTTP, Next.js, or JSON. Pure business logic over a
  typed input and scoped data-access. Lives in
  `packages/platform-api/src/handlers/`.

- **Adapter** — boundary translator between HTTP-land and handler-land.
  Takes a `NextRequest`, parses JSON body + path params into the input
  shape, builds `scope` from the authenticated caller, calls the handler,
  serializes output back to a `NextResponse`. Errors become HTTP status
  codes. Lives in `packages/platform-ui/src/lib/route-adapter.ts`
  (`createRouteAdapter`).

```
HTTP world                     Adapter                    Handler world
─────────────                  ───────                    ─────────────
NextRequest                    parse JSON                 input: ParsedInput
URL path params       ─────►   extract path     ─────►    scope: CallerScope
Authorization header           build scope                ↓
                                                          (pure logic)
                                                          ↓
NextResponse (JSON)   ◄─────   serialize         ◄─────   output: TypedOutput
HTTP status code               map ApiError → status      throw ApiError
```

This is the textbook ports-and-adapters / hexagonal split. The handler is
the application core; the adapter is one of N possible presentation
layers. Same handler, different adapter per consumer.

## Why headless

Today's adapters:

- `createRouteAdapter` → Next.js route file mount. (Only one in use.)

Forward-looking adapters the same handler can support without rewriting:

- `createHonoAdapter` → standalone HTTP server (Hono, Fastify, etc.) for
  a Phase 7 split deploy.
- `createCliCommand` → direct in-process invocation from
  `packages/cli/`, skipping the HTTP round-trip when the caller is the
  same machine as the server. *(Today the CLI uses the `Mediforce` HTTP
  client class instead — over HTTP to localhost. Direct invocation is
  available later if the cost of the round-trip matters.)*
- `createMcpTool` → MCP server tool definition wrapping the handler.

Handler stays one file. New consumers wrap it from outside.

## The pieces in code

| Concept | Package | File / dir | Purpose |
|---|---|---|---|
| **Contract** | `@mediforce/platform-api` | `contract/<domain>.ts` | Zod input + output schemas. The API surface. |
| **Handler** | `@mediforce/platform-api` | `handlers/<domain>/<name>.ts` | Pure function `(input, scope) => output`. Throws typed `ApiError`. |
| **Scope** | `@mediforce/platform-api` | `repositories/caller-scope.ts` + `authorized-*-repository.ts` | Per-request data-access bag with workspace authorization baked in. See [ADR-0004](./adr/0004-scoped-data-access-authorization.md). |
| **Adapter** | `@mediforce/platform-ui` | `lib/route-adapter.ts` | `createRouteAdapter(schema, fromReq, handler)` → Next.js route fn. Also `listAdapter` / `getByIdAdapter` for trivial reads. |
| **Route file** | `@mediforce/platform-ui` | `app/api/<path>/route.ts` | ~15 LOC. Imports contract + handler, wires the adapter. |
| **Client (typed)** | `@mediforce/platform-api/client` | `Mediforce` class | Browser + Node + CLI consume the same contract. Parses responses through output schemas. |

## Where decisions live

- [`docs/adr/0004-scoped-data-access-authorization.md`](./adr/0004-scoped-data-access-authorization.md)
  — `CallerScope` + `Authorized<Entity>Repository` wrappers; why
  authorization moved out of handlers and into the data-access boundary.
- [`docs/adr/0005-headless-platform-api-ui-separation.md`](./adr/0005-headless-platform-api-ui-separation.md)
  — Mutation handler contract: error envelope, typed `ApiError`, HTTP
  status mapping, response shape, Server Action policy, audit-bridge.
- [`docs/headless-migration.md`](./headless-migration.md)
  — Living phased plan executing the separation. Gets deleted when the
  migration completes; ADRs persist.

## Adapter responsibilities, in detail

`createRouteAdapter`:

1. Parse the `NextRequest` body / query / path params via the contract's
   input schema. Zod failure → `400` with the validation issues in
   `error.details`.
2. Resolve `CallerIdentity` (currently from Firebase ID token middleware
   set by [Filip's PR #220]; post-NextAuth ADR-0002 from cookie session).
3. Build `CallerScope` via `createCallerScope(rawServices, caller)`.
4. Invoke the handler `(input, scope) => Promise<output>`.
5. Catch `ApiError` → status from the mapping table (see ADR-0005
   §status mapping). Catch unexpected → `500` + `console.error`.
6. Serialize the handler's output to `NextResponse.json(output)`.

The route file is mechanical:

```ts
import { ClaimTaskInputSchema, claimTaskHandler } from '@mediforce/platform-api';
import { createRouteAdapter } from '@/lib/route-adapter';

export const POST = createRouteAdapter(
  ClaimTaskInputSchema,
  (req) => ({ taskId: req.params.taskId, ...await req.json() }),
  claimTaskHandler,
);
```

Trivial reads skip the handler file entirely via `listAdapter` /
`getByIdAdapter` — see ADR-0004 §10.

## What never goes in a handler

- `NextRequest`, `NextResponse`, `cookies()`, any Next.js import.
- Postgres / Drizzle imports (Firebase Admin SDK is Auth-only now).
- Raw repositories from `@mediforce/platform-core/interfaces`.
  Handler receives `CallerScope` only; the static guard
  `no-raw-repo-imports.test.ts` (ADR-0004 §9) enforces this in CI.

## What never goes in an adapter

- Business logic. Adapter is pure plumbing.
- State-machine validation. Lives in the handler or the entity-aware
  wrapper repo.
- Audit emission. Today handler-resident; future repo-resident (see
  "Captured for later" in `headless-migration.md`).

## The handler signature, illustrated

```ts
// contract/tasks.ts
export const ClaimTaskInputSchema = z.object({ taskId: z.string().min(1) });
export const ClaimTaskOutputSchema = z.object({ task: HumanTaskSchema });

// handlers/tasks/claim-task.ts
export const claimTaskHandler = async (
  input: ClaimTaskInput,
  scope: CallerScope,
): Promise<ClaimTaskOutput> => {
  if (!scope.caller.userId) {
    throw new ApiError('forbidden', 'User identity required');
  }
  const task = await scope.humanTasks.claim(input.taskId, scope.caller.userId);
  await scope.auditEvents.append({
    action: 'task.claimed',
    actorId: scope.caller.userId,
    /* … see ADR-0005 audit-bridge … */
  });
  return { task };
};
```

The handler reads as plain code: type-checked input, type-checked output,
typed errors, scoped data-access. Nothing else.

## Testing layers

See [`headless-migration.md`](./headless-migration.md) §Testing strategy
for the full pyramid. Short version:

- **Contract** — Zod schema invariants. <50ms.
- **Handler** — pure function against `InMemory*Repository` from
  `@mediforce/platform-core/testing`. No mocks.
- **Adapter** — `createRouteAdapter` wiring + error mapping. Sampled per
  route.
- **Cross-layer integration** — apiClient ↔ adapter ↔ handler ↔ repo,
  in-process via loopback `apiFetch`. One per major feature.
- **Structural guards** — `api-boundaries.test.ts`,
  `no-raw-repo-imports.test.ts` (ADR-0004), forthcoming
  mutation-pattern tests (ADR-0005).

## Glossary

Domain terms (Workflow Run, Human Task, Cowork Session, …) are defined
in [`CONTEXT.md`](../CONTEXT.md). This doc uses them as given; it
documents implementation concepts only.

Implementation concepts introduced here that aren't in `CONTEXT.md`:

- **Adapter** — boundary translator between transport (HTTP) and
  framework-free handler.
- **Handler** — pure framework-free function serving one API operation.
- **Scope** (a.k.a. `CallerScope`) — per-request data-access bag with
  workspace authorization wrappers around raw repositories. ADR-0004.
- **Contract** — Zod input + output schema for one API operation; the
  source of truth for the API.

These are code-architecture vocabulary, not domain vocabulary — they
deliberately live outside `CONTEXT.md`.
