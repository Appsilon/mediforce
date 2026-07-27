import type {
  ProcessRepository,
  TriggerRepository,
  WebhookTriggerResource,
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
  | { status: 400; error: string };

/**
 * WebhookRouter: path-based trigger dispatcher.
 *
 * Resolution order for `/api/triggers/webhook/<namespace>/<workflowName>/<suffix>`:
 *   1. Look up the latest WorkflowDefinition version belonging to the
 *      requested namespace (returns 0 if no version exists for that tenant).
 *   2. Find an **enabled** `webhook` trigger row in the unified `triggers`
 *      table (ADR-0011) whose config path matches the caller's suffix. Path
 *      comparison is exact (no globbing); a stopped webhook resolves to 404.
 *   3. Create the instance, start it, and return `{runId, statusUrl}`.
 *
 * Webhook triggers are detached table resources (Issue #931), NOT the advisory
 * `triggers[]` on the versioned definition — attaching/stopping/removing a
 * webhook takes effect immediately without cutting a new definition version.
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

    const triggerPayload = {
      body: input.body,
      headers: input.headers ?? {},
      query: input.query ?? {},
      method: upperMethod,
      path: normalizedSuffix,
    };

    const triggeredBy = input.triggeredBy ?? 'webhook';
    const instance = await this.engine.createInstance(
      definition.namespace,
      definition.name,
      definition.version,
      triggeredBy,
      'webhook',
      triggerPayload,
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
