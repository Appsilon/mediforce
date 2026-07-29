import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';

/**
 * Catch-all webhook endpoint:
 *   /api/triggers/webhook/<namespace>/<workflowName>/<triggerSuffix...>
 *
 * The proxy already enforces auth (X-Api-Key or the NextAuth session cookie),
 * so this handler only owns URL parsing, delegating to WebhookRouter, and
 * fire-and-forget kicking the auto-runner. Decision B5: full async — the
 * caller polls /api/runs/<runId> for completion.
 */
/**
 * Request headers that never reach the run. Everything else lands on the Run's
 * `triggerContext` (ADR-0012), which is persisted to `process_instances` and
 * readable from any step as `${triggerContext.headers.*}` — so forwarding these
 * would let any workflow author in the namespace interpolate the caller's
 * credentials (including this platform's own `x-api-key`) straight into an
 * outbound `http` action. The endpoint has already authenticated by this point,
 * so nothing downstream needs them.
 */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  if (!Array.isArray(path) || path.length < 3) {
    return NextResponse.json(
      {
        error:
          'Webhook URL must be /api/triggers/webhook/<namespace>/<workflowName>/<triggerSuffix>',
      },
      { status: 400 },
    );
  }

  const [namespace, workflowName, ...suffixSegments] = path;
  const suffix = `/${suffixSegments.join('/')}`;

  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  } catch {
    body = null;
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (CREDENTIAL_HEADERS.has(key.toLowerCase())) return;
    headers[key] = value;
  });
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const { webhookRouter } = getPlatformServices();
  const result = await webhookRouter.route({
    namespace,
    workflowName,
    suffix,
    method: req.method,
    body,
    headers,
    query,
    triggeredBy: 'webhook',
  });

  if (result.status !== 202) {
    // `details` carries the per-field `triggerInput` errors on a 400 so a sender
    // whose body missed the contract sees exactly which fields were wrong —
    // same information `start-run` returns for a rejected manual payload
    // (ADR-0012). Added alongside the existing flat `error` string rather than
    // replacing it, so 404/405 consumers read unchanged.
    const details = 'details' in result ? result.details : undefined;
    return NextResponse.json(
      { error: result.error, ...(details === undefined ? {} : { details }) },
      { status: result.status },
    );
  }

  // Fire-and-forget: kick the auto-runner so the workflow actually executes.
  // Same pattern as POST /api/processes for manual triggers.
  //
  // Without PLATFORM_API_KEY the kick would 401 silently (middleware drops it
  // before any handler runs) and the run would stay queued forever. Surface
  // misconfiguration immediately instead of returning 202 + dead instance.
  const apiKey = process.env.PLATFORM_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    console.error(
      `[webhook] PLATFORM_API_KEY missing — cannot kick auto-runner for run ${result.runId}`,
    );
    return NextResponse.json(
      {
        error:
          'Server is misconfigured: PLATFORM_API_KEY is not set. Webhook accepted but workflow cannot start.',
        runId: result.runId,
      },
      { status: 500 },
    );
  }

  const baseUrl = getAppBaseUrl();
  fetch(`${baseUrl}/api/processes/${result.runId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ triggeredBy: 'webhook' }),
  }).catch((err) => {
    console.error(`[webhook] Failed to kick auto-runner for ${result.runId}:`, err);
  });

  return NextResponse.json(
    { runId: result.runId, statusUrl: result.statusUrl },
    { status: 202 },
  );
}
