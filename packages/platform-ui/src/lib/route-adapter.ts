import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  httpStatusForApiErrorCode,
  type ApiErrorCode,
} from '@mediforce/platform-api/errors';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { createCallerScope, type CallerScope } from '@mediforce/platform-api/repositories';
import { resolveCallerIdentity } from './api-auth.js';
import { getPlatformServices } from './platform-services.js';

/**
 * Wraps a pure handler (from `@mediforce/platform-api`) into a Next.js route.
 *
 * The adapter is the single place that translates between Next.js's
 * `Request`/`NextResponse` world and the framework-free handler world. Every
 * `/api/*` route should compose through it — never re-implement auth, input
 * parsing, or error-to-status mapping inline.
 *
 * Pipeline (in order, short-circuits on first failure):
 *
 *   1. Auth — `resolveCallerIdentity` reads `X-Api-Key` or a Firebase ID
 *      token. Failure → 401. The resolved `CallerIdentity` is threaded into
 *      the handler so domain code can enforce namespace policy.
 *   2. Input — `inputFromRequest(req, ctx)` returns a raw object; the Zod
 *      schema validates it. Failure → 400 with the first issue's message.
 *      Note: `ctx` is Next.js's `RouteContext` shape (`{ params: Promise<…> }`)
 *      for dynamic-segment routes, or `unknown` for flat routes.
 *   3. Handler — invoked with the parsed input and a `CallerScope`. Throws of
 *      type `ApiError` map their `code` to an HTTP status via
 *      `httpStatusForApiErrorCode`. `ZodError` becomes a 400. Anything else is
 *      a 500 (full error logged).
 *
 * Auth note: middleware in `src/middleware.ts` already gates `/api/*` for
 * presence of credentials — that's the first line of defense and exists so
 * unauthenticated traffic never reaches handler code. The adapter's own
 * resolution step is what turns those credentials into a typed
 * `CallerIdentity` for namespace policy. Both run today; do not remove either.
 *
 * Test seams: pass `options.resolveCaller` to bypass real Firebase /
 * Firestore auth, or `options.buildScope` to substitute a stub scope without
 * spinning up services. Production code never sets either.
 *
 * The `NarrowInput` generic defaults to `z.infer<InputSchema>`. Pass it
 * explicitly when the handler expects a narrower type than the schema's
 * `z.infer`, e.g. a discriminated union backed by a Zod refine. Must be a
 * *strict subset* of `z.infer<InputSchema>` — the adapter casts `parsed.data`
 * to `NarrowInput` on success, the cast is trusted, not verified.
 */
export interface RouteAdapterOptions {
  /** Override caller resolution. Default reads from request headers. */
  readonly resolveCaller?: (req: NextRequest) => Promise<CallerIdentity | NextResponse>;
  /** Override scope construction. Default wires the platform's real services. */
  readonly buildScope?: (caller: CallerIdentity) => CallerScope;
}

export type RouteHandler<Input, Output> = (
  input: Input,
  scope: CallerScope,
) => Promise<Output>;

export function createRouteAdapter<
  InputSchema extends z.ZodType,
  NarrowInput = z.infer<InputSchema>,
  Output = unknown,
  Ctx = unknown,
>(
  inputSchema: InputSchema,
  inputFromRequest: (req: NextRequest, ctx: Ctx) => unknown | Promise<unknown>,
  handler: RouteHandler<NarrowInput, Output>,
  options: RouteAdapterOptions = {},
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  const resolveCaller = options.resolveCaller ?? defaultResolveCaller;
  const buildScope = options.buildScope ?? defaultBuildScope;

  return async (req, ctx) => {
    const callerOrResponse = await resolveCaller(req);
    if (callerOrResponse instanceof NextResponse) return callerOrResponse;
    const caller = callerOrResponse;

    let raw: unknown;
    try {
      raw = await inputFromRequest(req, ctx);
    } catch (err) {
      console.error('[route-adapter] inputFromRequest error:', err);
      return jsonError('validation', 'Invalid input');
    }

    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'validation',
        parsed.error.issues[0]?.message ?? 'Invalid input',
        parsed.error.issues,
      );
    }

    try {
      const scope = buildScope(caller);
      const result = await handler(parsed.data as NarrowInput, scope);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonError(err.code, err.message, err.details);
      }
      if (err instanceof z.ZodError) {
        return jsonError('validation', 'Invalid input', err.issues);
      }
      console.error('[route-adapter] handler error:', err);
      return jsonError('internal', 'Internal error');
    }
  };
}

/**
 * Serialize the ADR-0005 §1 envelope. `code` drives the HTTP status via the
 * §3 table — single source of truth across reads and mutations.
 */
function jsonError(code: ApiErrorCode, message: string, details?: unknown): NextResponse {
  const body: { error: { code: ApiErrorCode; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status: httpStatusForApiErrorCode(code) });
}

function defaultBuildScope(caller: CallerIdentity): CallerScope {
  return createCallerScope(getPlatformServices(), caller);
}

async function defaultResolveCaller(req: NextRequest): Promise<CallerIdentity | NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  return resolveCallerIdentity(req, namespaceRepo);
}
