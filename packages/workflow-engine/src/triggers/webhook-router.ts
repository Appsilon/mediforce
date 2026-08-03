import type {
  PayloadValidationError,
  ProcessRepository,
  TriggerRepository,
  WebhookTriggerResource,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import {
  isJsonObject,
  resolveRunnableVersion,
  toWorkflowVersionSource,
  validatePayload,
} from '@mediforce/platform-core';
import type { WorkflowEngine } from '../engine/workflow-engine';

/** Caller-supplied request shape — normalized to the runtime's vocabulary
 *  so the router can be driven from any HTTP framework. */
export interface WebhookRouteInput {
  namespace: string;
  workflowName: string;
  /** Trigger suffix from the URL (e.g. `execution-summaries`). May be a
   *  multi-segment slash-joined path. The router prepends `/` before
   *  matching against `WebhookTriggerConfig.path`. */
  suffix: string;
  method: string;
  body: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** Identifier used in audit log + ProcessInstance.createdBy. Defaults to
   *  'webhook' when the caller can't supply something more specific. */
  triggeredBy?: string;
}

export type WebhookRouteResult =
  | { status: 202; runId: string; statusUrl: string }
  | { status: 404; error: string }
  | { status: 405; error: string }
  // `details` carries the per-field validation errors, mirroring what
  // `start-run` returns for a bad manual payload so a sender debugging a
  // rejected body reads the same message on either path (ADR-0012).
  | { status: 400; error: string; details?: PayloadValidationError[] };

/**
 * WebhookRouter: path-based trigger dispatcher.
 *
 * Resolution order for `/api/triggers/webhook/<namespace>/<workflowName>/<suffix>`:
 *   1. Resolve the WorkflowDefinition version this firing runs, scoped to the
 *      requested namespace, through the one shared policy every unpinned firing
 *      uses (`resolveRunnableVersion`, ADR-0011) — 404 when nothing is runnable.
 *   2. Find an **enabled** `webhook` trigger row in the unified `triggers`
 *      table (ADR-0011) whose config path matches the caller's suffix. Path
 *      comparison is exact (no globbing); a stopped webhook resolves to 404.
 *   3. Map the JSON body's top-level keys onto the definition's `triggerInput`
 *      contract and validate — 400 with per-field errors on failure (ADR-0012).
 *   4. Create the instance, start it, and return `{runId, statusUrl}`.
 *
 * The webhook is an **adapter**, not an input shape: after step 3 the Run's
 * `triggerPayload` is the same validated, trigger-agnostic object a manual or
 * cron firing would produce, so `${triggerPayload.<field>}` in a step reads
 * identically whichever trigger fired. The HTTP envelope the body arrived in
 * (`headers`/`query`/`method`/`path`) is *not* input — it lands on the Run's
 * `triggerContext`, where a step reading it is visibly opting into webhook-only
 * behaviour, minus the credential headers this adapter strips
 * (`CREDENTIAL_HEADERS`).
 *
 * Webhook triggers are detached table resources (Issue #931). Attaching,
 * stopping, or removing a webhook takes effect immediately without cutting a
 * new definition version.
 *
 * Namespace scoping at the version-lookup level prevents tenant A from
 * accidentally surfacing tenant B's workflow when both registered the same
 * `name` (the underlying storage is keyed by `namespace:name:version`).
 *
 * The router is framework-agnostic — Next.js, queue worker, websocket bridge
 * can all forward into it. Engine work (createInstance + startInstance) is
 * synchronous; the auto-runner is kicked separately by the route forwarder.
 */
export class WebhookRouter {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly processRepository: ProcessRepository,
    private readonly triggerRepository: TriggerRepository,
  ) {}

  async route(input: WebhookRouteInput): Promise<WebhookRouteResult> {
    if (input.namespace.length === 0 || input.workflowName.length === 0) {
      return { status: 400, error: 'namespace and workflowName are required' };
    }

    // The one shared policy every unpinned firing resolves through (ADR-0011),
    // the same one a manual start, the cron heartbeat, and spawn use — a webhook
    // firing must land on the version any other trigger would fire, or
    // ADR-0012's single `triggerInput` contract splits per trigger.
    const resolution = await resolveRunnableVersion(
      toWorkflowVersionSource(this.processRepository),
      input.namespace,
      input.workflowName,
    );
    // Every `ok: false` reason is a 404 on the firing path, matching how the
    // router already reports a workflow it cannot find: a deleted or
    // fully-archived workflow must not fire a ghost run, and a stale trigger row
    // pointing at one is a missing endpoint, not a server fault.
    if (resolution.ok === false) {
      return {
        status: 404,
        error:
          `No runnable workflow definition for '${input.workflowName}' ` +
          `in namespace '${input.namespace}': ${resolution.reason}`,
      };
    }
    const definition = resolution.def;

    const normalizedSuffix = normalizeSuffix(input.suffix);
    const upperMethod = input.method.toUpperCase();

    const trigger = await this.findMatchingWebhookTrigger(
      input.namespace,
      input.workflowName,
      normalizedSuffix,
    );
    if (trigger === null) {
      return {
        status: 404,
        error: `No webhook trigger matches path '${normalizedSuffix}' on '${input.workflowName}'`,
      };
    }

    if (trigger.config.method !== upperMethod) {
      return {
        status: 405,
        error: `Method '${upperMethod}' not allowed; trigger expects '${trigger.config.method}'`,
      };
    }

    const mapped = mapBodyToPayload(input.body, definition);
    if (mapped.ok === false) return mapped.rejection;

    const triggeredBy = input.triggeredBy ?? 'webhook';
    const instance = await this.engine.createInstance(
      definition.namespace,
      definition.name,
      definition.version,
      triggeredBy,
      'webhook',
      mapped.payload,
      {
        triggerContext: {
          headers: stripCredentialHeaders(input.headers ?? {}),
          query: input.query ?? {},
          method: upperMethod,
          path: normalizedSuffix,
        },
      },
    );
    await this.engine.startInstance(instance.id);

    return {
      status: 202,
      runId: instance.id,
      statusUrl: `/api/runs/${instance.id}`,
    };
  }

  /** Resolve an enabled `webhook` trigger row whose path matches the suffix.
   *  A stopped (disabled) row is invisible, so its endpoint stops resolving. */
  private async findMatchingWebhookTrigger(
    namespace: string,
    workflowName: string,
    normalizedSuffix: string,
  ): Promise<WebhookTriggerResource | null> {
    const rows = await this.triggerRepository.listByWorkflow(namespace, workflowName);
    const match = rows.find(
      (row): row is WebhookTriggerResource =>
        row.type === 'webhook' && row.enabled === true && row.config.path === normalizedSuffix,
    );
    return match ?? null;
  }
}

function normalizeSuffix(rawSuffix: string): string {
  if (rawSuffix.length === 0) return '/';
  return rawSuffix.startsWith('/') ? rawSuffix : `/${rawSuffix}`;
}

/**
 * Request headers that never reach the Run. Everything else lands on the Run's
 * `triggerContext` (ADR-0012), which is persisted to `process_instances` and
 * readable from any step as `${triggerContext.headers.*}` — so forwarding these
 * would let any workflow author in the namespace interpolate the caller's
 * credentials (including this platform's own `x-api-key`) straight into an
 * outbound `http` action. The HTTP forwarder has already authenticated by the
 * time it reaches the router, so nothing downstream needs them.
 */
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key']);

/**
 * Drop credential headers before they land on the context. This is the
 * adapter's guarantee, not any one HTTP forwarder's, so it holds for every
 * caller of `route()`.
 *
 * Matching is case-insensitive because HTTP header names are — a caller
 * forwarding a raw record may not have lowercased them. Surviving headers keep
 * the caller's original casing.
 */
function stripCredentialHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (CREDENTIAL_HEADERS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

type MappedBody =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; rejection: { status: 400; error: string; details?: PayloadValidationError[] } };

/**
 * Map a webhook JSON body onto the definition's `triggerInput` contract
 * (ADR-0012, D4): the body's **top-level keys are the declared field names**,
 * 1:1, and the result is validated like any other firing.
 *
 * An empty contract admits only an empty body — a sender posting fields the
 * workflow never declared is a mistake worth a 400, not something to silently
 * drop. A body that isn't a JSON object has no top-level keys to map, so it
 * cannot satisfy any contract; a workflow that wants an opaque blob declares one
 * `object`-typed field and the sender nests under it.
 */
function mapBodyToPayload(body: unknown, definition: WorkflowDefinition): MappedBody {
  const triggerInput = definition.triggerInput ?? [];

  // `undefined`/`null` is an absent body, not a malformed one: a contract-free
  // webhook fired with no body is the normal ping case, so it maps to the empty
  // payload and only fails if the contract demands something.
  const isAbsent = body === undefined || body === null;

  if (isAbsent === false && isJsonObject(body) === false) {
    return {
      ok: false,
      rejection: {
        status: 400,
        error:
          `Webhook body must be a JSON object whose top-level keys are the workflow's ` +
          `triggerInput fields${describeContract(triggerInput)}`,
      },
    };
  }

  const validation = validatePayload(
    isAbsent ? {} : (body as Record<string, unknown>),
    triggerInput,
  );
  if (validation.valid === false) {
    return {
      ok: false,
      rejection: {
        status: 400,
        error: isAbsent
          ? `Webhook body is missing${describeContract(triggerInput)}`
          : `Webhook body does not match the workflow's triggerInput contract${describeContract(triggerInput)}`,
        details: validation.errors,
      },
    };
  }
  return { ok: true, payload: validation.payload };
}

/** Name the expected fields in the rejection so a sender fixes the body without
 *  having to go read the workflow definition. */
function describeContract(triggerInput: WorkflowDefinition['triggerInput']): string {
  const fields = triggerInput ?? [];
  if (fields.length === 0) return ' (this workflow declares no triggerInput, so the body must be empty)';
  return ` (expected: ${fields.map((field) => `${field.name}: ${field.type ?? 'string'}`).join(', ')})`;
}
