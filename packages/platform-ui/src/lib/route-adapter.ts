import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HandlerError } from '@mediforce/platform-api/errors';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { createCallerScope, type CallerScope } from '@mediforce/platform-api/repositories';
import { createHttpSelfFetchRunKicker, type RunKicker } from '@mediforce/platform-api/runtime';
import { resolveCallerIdentity } from './api-auth';
import { getPlatformServices } from './platform-services';
import { getAppBaseUrl } from './app-base-url';

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
 *      type `HandlerError` (or any subclass: `NotFoundError`, `ForbiddenError`,
 *      `PreconditionFailedError`, etc.) map to the ADR-0005 §1 envelope using
 *      `err.code`. Anything else is a 500 (full error logged).
 *
 * Auth note: the proxy in `src/proxy.ts` already gates `/api/*` for
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
  /**
   * HTTP status returned on successful handler invocation. Defaults to 200.
   * Set to 201 for routes that create a resource (preserving the inline-route
   * `NextResponse.json(..., { status: 201 })` contract that clients assert on).
   */
  readonly successStatus?: number;
}

export type RouteHandler<Input, Output> = (input: Input, scope: CallerScope) => Promise<Output>;

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
  const successStatus = options.successStatus ?? 200;

  return async (req, ctx) => {
    const callerOrResponse = await resolveCaller(req);
    if (callerOrResponse instanceof NextResponse) return callerOrResponse;
    const caller = callerOrResponse;

    let raw: unknown;
    try {
      raw = await inputFromRequest(req, ctx);
    } catch (err) {
      console.error('[route-adapter] inputFromRequest error:', err);
      return jsonErrorResponse(new HandlerError('validation', 'Invalid input'));
    }

    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonErrorResponse(
        new HandlerError('validation', parsed.error.issues[0]?.message ?? 'Invalid input', parsed.error.issues),
      );
    }

    try {
      const scope = buildScope(caller);
      const result = await handler(parsed.data as NarrowInput, scope);
      return NextResponse.json(result, { status: successStatus });
    } catch (err) {
      if (err instanceof HandlerError) return jsonErrorResponse(err);
      if (err instanceof z.ZodError) {
        console.error('[route-adapter] handler ZodError:', err.issues);
        return jsonErrorResponse(new HandlerError('validation', 'Invalid input', err.issues));
      }
      console.error('[route-adapter] handler error:', err);
      return jsonErrorResponse(new HandlerError('internal', 'Internal error'));
    }
  };
}

// `HandlerError.toEnvelope()` is the ADR-0005 §1 wire shape; `statusCode` is
// derived from `code` via the §3 table inside the class. This adapter is the
// only place that turns a HandlerError into an HTTP response.
function jsonErrorResponse(err: HandlerError): NextResponse {
  return NextResponse.json(err.toEnvelope(), { status: err.statusCode });
}

const prodRunKicker: RunKicker = createHttpSelfFetchRunKicker({
  baseUrl: getAppBaseUrl,
  apiKey: () => process.env.PLATFORM_API_KEY ?? '',
});

// Exported for the rare non-JSON route (binary file download) that can't
// compose through `createRouteAdapter` but MUST run the identical auth +
// scope pipeline. Everything JSON goes through the adapter — see module doc.
export function defaultBuildScope(caller: CallerIdentity): CallerScope {
  return createCallerScope({ ...getPlatformServices(), runKicker: prodRunKicker }, caller);
}

export async function defaultResolveCaller(req: NextRequest): Promise<CallerIdentity | NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  return resolveCallerIdentity(req, namespaceRepo);
}
