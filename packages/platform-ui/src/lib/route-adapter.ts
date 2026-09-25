import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  HandlerError,
  PayloadTooLargeError,
  ValidationError,
} from '@mediforce/platform-api/errors';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { hasProductionEvaluators, productionEvaluatorGate } from '@mediforce/platform-api/handlers';
import { createCallerScope, type CallerScope } from '@mediforce/platform-api/repositories';
import { createHttpSelfFetchRunKicker, type RunKicker } from '@mediforce/platform-api/runtime';
import type { AgentOutputGate } from '@mediforce/agent-runtime';
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
 *   1. Auth — `resolveCallerIdentity` reads `X-Api-Key` or the NextAuth
 *      session cookie. Failure → 401. The resolved `CallerIdentity` is
 *      threaded into the handler so domain code can enforce namespace policy.
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
 * Test seams: pass `options.resolveCaller` to bypass the real session /
 * API-key resolution, or `options.buildScope` to substitute a stub scope
 * without spinning up services. Production code never sets either.
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
  const successStatus = options.successStatus ?? 200;

  return async (req, ctx) => {
    const prepared = await prepareInvocation(req, ctx, inputSchema, inputFromRequest, resolveCaller, buildScope);
    if (prepared instanceof NextResponse) return prepared;
    try {
      const result = await handler(prepared.input as NarrowInput, prepared.scope);
      return NextResponse.json(result, { status: successStatus });
    } catch (err) {
      return jsonErrorResponse(toHandlerError(err));
    }
  };
}

export type ProgressRouteHandler<Input, Output, Progress> = (
  input: Input,
  scope: CallerScope,
  onProgress: (event: Progress) => void,
) => Promise<Output>;

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson';

/**
 * `createRouteAdapter` for a long-running handler that reports progress. A
 * request that sends `Accept: application/x-ndjson` gets a stream of JSON lines
 * — `{ progress }` as the handler reports it, then exactly one `{ result }` or
 * the ADR-0005 `{ error }` envelope. Any other request gets the plain JSON
 * response `createRouteAdapter` would give. Auth and input failures are
 * ordinary JSON errors in both cases, since they happen before the stream opens.
 */
export function createProgressRouteAdapter<InputSchema extends z.ZodType, Output, Progress>(
  inputSchema: InputSchema,
  inputFromRequest: (req: NextRequest, ctx: unknown) => unknown | Promise<unknown>,
  handler: ProgressRouteHandler<z.infer<InputSchema>, Output, Progress>,
  options: Pick<RouteAdapterOptions, 'resolveCaller' | 'buildScope'> = {},
): (req: NextRequest, ctx: unknown) => Promise<NextResponse> {
  const resolveCaller = options.resolveCaller ?? defaultResolveCaller;
  const buildScope = options.buildScope ?? defaultBuildScope;

  return async (req, ctx) => {
    const prepared = await prepareInvocation(req, ctx, inputSchema, inputFromRequest, resolveCaller, buildScope);
    if (prepared instanceof NextResponse) return prepared;
    if (req.headers.get('accept')?.includes(NDJSON_CONTENT_TYPE) !== true) {
      try {
        return NextResponse.json(await handler(prepared.input, prepared.scope, () => {}));
      } catch (err) {
        return jsonErrorResponse(toHandlerError(err));
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (line: unknown) => {
          if (open === false) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          } catch {
            open = false;
          }
        };
        try {
          send({ result: await handler(prepared.input, prepared.scope, (progress) => send({ progress })) });
        } catch (err) {
          send(toHandlerError(err).toEnvelope());
        }
        if (open === true) controller.close();
      },
    });
    return new NextResponse(stream, {
      headers: { 'Content-Type': NDJSON_CONTENT_TYPE, 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  };
}

async function prepareInvocation<InputSchema extends z.ZodType, Ctx>(
  req: NextRequest,
  ctx: Ctx,
  inputSchema: InputSchema,
  inputFromRequest: (req: NextRequest, ctx: Ctx) => unknown | Promise<unknown>,
  resolveCaller: (req: NextRequest) => Promise<CallerIdentity | NextResponse>,
  buildScope: (caller: CallerIdentity) => CallerScope,
): Promise<{ input: z.infer<InputSchema>; scope: CallerScope } | NextResponse> {
  const callerOrResponse = await resolveCaller(req);
  if (callerOrResponse instanceof NextResponse) return callerOrResponse;

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
      new HandlerError(
        'validation',
        parsed.error.issues[0]?.message ?? 'Invalid input',
        parsed.error.issues,
      ),
    );
  }
  try {
    return { input: parsed.data, scope: buildScope(callerOrResponse) };
  } catch (err) {
    return jsonErrorResponse(toHandlerError(err));
  }
}

function toHandlerError(err: unknown): HandlerError {
  if (err instanceof HandlerError) return err;
  if (err instanceof z.ZodError) {
    console.error('[route-adapter] handler ZodError:', err.issues);
    return new HandlerError('validation', 'Invalid input', err.issues);
  }
  console.error('[route-adapter] handler error:', err);
  return new HandlerError('internal', 'Internal error');
}

export interface MultipartRouteAdapterOptions
  extends Pick<RouteAdapterOptions, 'resolveCaller' | 'buildScope' | 'successStatus'> {
  /** Prefix for the route's server logs, e.g. `task-attachment-upload-route`. */
  readonly logTag: string;
  /** The 413 message when the body cannot be parsed. */
  readonly unreadableBodyMessage: string;
}

/**
 * `createRouteAdapter` for a `multipart/form-data` body: the same auth, scope
 * and error tail, with the form parsed here. `inputFromForm` builds the
 * handler's input and throws a `HandlerError` for a form it cannot use.
 *
 * Next caps every body at `proxyClientMaxBodySize` (next.config.mjs) and
 * TRUNCATES a larger one before the route runs, which makes the parse fail —
 * so a parse failure is a 413, the dominant cause, not a generic 500.
 */
export function createMultipartRouteAdapter<Input, Output = unknown, Ctx = unknown>(
  inputFromForm: (form: FormData, req: NextRequest, ctx: Ctx) => Input | Promise<Input>,
  handler: RouteHandler<Input, Output>,
  options: MultipartRouteAdapterOptions,
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  const resolveCaller = options.resolveCaller ?? defaultResolveCaller;
  const buildScope = options.buildScope ?? defaultBuildScope;
  const successStatus = options.successStatus ?? 200;

  return async (req, ctx) => {
    const callerOrResponse = await resolveCaller(req);
    if (callerOrResponse instanceof NextResponse) return callerOrResponse;
    const scope = buildScope(callerOrResponse);

    try {
      if (req.headers.get('content-type')?.startsWith('multipart/form-data') !== true) {
        throw new ValidationError('Send the request as multipart/form-data.');
      }
      let form: FormData;
      try {
        form = await req.formData();
      } catch (parseErr) {
        console.warn(`[${options.logTag}] request body parse failed (likely exceeds the upload size limit):`, parseErr);
        throw new PayloadTooLargeError(options.unreadableBodyMessage);
      }
      const input = await inputFromForm(form, req, ctx);
      return NextResponse.json(await handler(input, scope), { status: successStatus });
    } catch (err) {
      if (err instanceof HandlerError) return jsonErrorResponse(err);
      console.error(`[${options.logTag}] handler error:`, err);
      return jsonErrorResponse(new HandlerError('internal', 'Internal error'));
    }
  };
}

// `HandlerError.toEnvelope()` is the ADR-0005 §1 wire shape; `statusCode` is
// derived from `code` via the §3 table inside the class. This adapter is the
// canonical place that turns a HandlerError into an HTTP response; the rare
// binary routes that can't compose through `createRouteAdapter` reuse this so
// their error envelopes stay byte-identical to the JSON routes'.
export function jsonErrorResponse(err: HandlerError): NextResponse {
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
  return createCallerScope(
    { ...getPlatformServices(), runKicker: prodRunKicker },
    caller,
  );
}

/** The output gate a step's production Evaluators put on its runs (ADR-0023 D13), or undefined when it has none. */
export async function buildProductionOutputGate(
  step: { namespace: string; workflowName: string; stepId: string },
): Promise<AgentOutputGate | undefined> {
  const systemScope = defaultBuildScope({ kind: 'apiKey', isSystemActor: true });
  return await hasProductionEvaluators(systemScope, step) ? productionEvaluatorGate(systemScope) : undefined;
}

export async function defaultResolveCaller(req: NextRequest): Promise<CallerIdentity | NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  return resolveCallerIdentity(req, namespaceRepo);
}
