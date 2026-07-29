import type {
  PayloadValidationError,
  ProcessRepository,
  TriggerRepository,
  WebhookTriggerResource,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import { validatePayload } from '@mediforce/platform-core';
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
 *   1. Look up the latest WorkflowDefinition version belonging to the
 *      requested namespace (returns 0 if no version exists for that tenant).
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
 * behaviour.
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

    const version = await this.processRepository.getLatestWorkflowVersion(
      input.namespace,
      input.workflowName,
    );
    if (version === 0) {
      return {
        status: 404,
        error: `No workflow definition for '${input.workflowName}' in namespace '${input.namespace}'`,
      };
    }

    const definition = await this.processRepository.getWorkflowDefinition(
      input.namespace,
      input.workflowName,
      version,
    );
    if (!definition) {
      return {
        status: 404,
        error: `No workflow definition for '${input.workflowName}' v${version}`,
      };
    }

    const normalizedSuffix = normalizeSuffix(input.suffix);
    const upperMethod = input.method.toUpperCase();

    const trigger = await this.findMatchingWebhookTrigger(
      input.namespace,
      input.workflowName,
      normalizedSuffix,
    );
    if (!trigger) {
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
    if (!mapped.ok) return mapped.rejection;

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
          headers: input.headers ?? {},
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
        row.type === 'webhook' && row.enabled && row.config.path === normalizedSuffix,
    );
    return match ?? null;
  }
}

function normalizeSuffix(rawSuffix: string): string {
  if (rawSuffix.length === 0) return '/';
  return rawSuffix.startsWith('/') ? rawSuffix : `/${rawSuffix}`;
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

  if (typeof body === 'object' && Array.isArray(body) === false && body !== null) {
    const payload = body as Record<string, unknown>;
    const validation = validatePayload(payload, triggerInput);
    if (!validation.valid) {
      return {
        ok: false,
        rejection: {
          status: 400,
          error: `Webhook body does not match the workflow's triggerInput contract${describeContract(triggerInput)}`,
          details: validation.errors,
        },
      };
    }
    return { ok: true, payload };
  }

  // `undefined`/`null` is an absent body, not a malformed one: a contract-free
  // webhook fired with no body is the normal ping case, so it maps to the empty
  // payload and only fails if the contract demands something.
  if (body === undefined || body === null) {
    const validation = validatePayload({}, triggerInput);
    if (!validation.valid) {
      return {
        ok: false,
        rejection: {
          status: 400,
          error: `Webhook body is missing${describeContract(triggerInput)}`,
          details: validation.errors,
        },
      };
    }
    return { ok: true, payload: {} };
  }

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

/** Name the expected fields in the rejection so a sender fixes the body without
 *  having to go read the workflow definition. */
function describeContract(triggerInput: WorkflowDefinition['triggerInput']): string {
  const fields = triggerInput ?? [];
  if (fields.length === 0) return ' (this workflow declares no triggerInput, so the body must be empty)';
  return ` (expected: ${fields.map((field) => `${field.name}: ${field.type ?? 'string'}`).join(', ')})`;
}
