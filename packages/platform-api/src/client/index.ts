import {
  ListTasksInputSchema,
  ListTasksOutputSchema,
  RegisterWorkflowInputSchema,
  RegisterWorkflowOutputSchema,
  ListWorkflowsOutputSchema,
  GetWorkflowInputSchema,
  GetWorkflowOutputSchema,
  GetRunInputSchema,
  GetRunOutputSchema,
  StartRunInputSchema,
  StartRunOutputSchema,
  ListRunsInputSchema,
  ListRunsOutputSchema,
  type ListTasksInput,
  type ListTasksOutput,
  type RegisterWorkflowInput,
  type RegisterWorkflowOutput,
  type RegisterWorkflowOptions,
  type ListWorkflowsOutput,
  type GetWorkflowInput,
  type GetWorkflowOutput,
  type GetRunInput,
  type GetRunOutput,
  type StartRunInput,
  type StartRunOutput,
  type ListRunsInput,
  type ListRunsOutput,
} from '../contract/index.js';

/**
 * Typed client for the Mediforce API. Runtime-agnostic — works in the
 * browser, Node (agent / CLI / MCP server), or a test loopback, depending
 * on how it's configured.
 *
 * Exactly one of three auth/transport options must be provided:
 *
 *   - `apiKey`      — server-to-server trust. Uses `globalThis.fetch`,
 *                     attaches `X-Api-Key`, **requires a non-empty `baseUrl`**
 *                     (server-to-server always has a remote target;
 *                     `fetch('/api/...')` throws `Invalid URL` in Node).
 *   - `bearerToken` — user-session auth. Called per request; attaches
 *                     `Authorization: Bearer <token>` (or skips the header
 *                     when the callback returns `null`). `baseUrl` is optional
 *                     — same-origin `/api/*` just works in the browser.
 *   - `fetch`       — escape hatch. Supply a fetch-compatible function with
 *                     auth already handled (via closure) or none at all
 *                     (test loopback where middleware is bypassed). `baseUrl`
 *                     is optional — the injected fetch owns URL resolution.
 *
 * Firebase is never imported by this class — a browser wrapper that reads
 * Firebase ID tokens lives in `packages/platform-ui/src/lib/mediforce.ts`.
 */

interface BaseClientConfig {
  /** Base URL prepended to every request path. Default: `''` (relative). */
  baseUrl?: string;
}

/**
 * Exactly one of `apiKey`, `bearerToken`, or `fetch` must be provided.
 * Modeled as a discriminated union so TypeScript rejects combinations at the
 * call site; the runtime `authSources !== 1` check in the constructor is
 * kept as defense-in-depth for JS callers / bad casts.
 *
 * The `apiKey` variant makes `baseUrl` required because server-to-server
 * callers always target a remote host — relative paths throw in Node.
 */
export type ClientConfig =
  | (BaseClientConfig & { apiKey: string; baseUrl: string; bearerToken?: never; fetch?: never })
  | (BaseClientConfig & { bearerToken: () => Promise<string | null>; apiKey?: never; fetch?: never })
  | (BaseClientConfig & { fetch: typeof fetch; apiKey?: never; bearerToken?: never });

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class Mediforce {
  readonly tasks: {
    list: (input: ListTasksInput) => Promise<ListTasksOutput>;
  };

  readonly workflows: {
    register: (
      input: RegisterWorkflowInput,
      options: RegisterWorkflowOptions,
    ) => Promise<RegisterWorkflowOutput>;
    list: () => Promise<ListWorkflowsOutput>;
    get: (input: GetWorkflowInput) => Promise<GetWorkflowOutput>;
  };

  readonly runs: {
    list: (input?: ListRunsInput) => Promise<ListRunsOutput>;
    get: (input: GetRunInput) => Promise<GetRunOutput>;
    start: (input: StartRunInput) => Promise<StartRunOutput>;
  };

  constructor(private readonly config: ClientConfig) {
    // Defense-in-depth against JS callers / bad casts that bypass the
    // discriminated union (e.g. `new Mediforce()` with no argument, which the
    // type system already rejects). Treat a missing config like one with no
    // auth sources, triggering the same "exactly one" error below.
    const safeConfig = (config ?? {}) as Partial<{
      apiKey: string;
      bearerToken: () => Promise<string | null>;
      fetch: typeof fetch;
    }>;
    const authSources = [safeConfig.apiKey, safeConfig.bearerToken, safeConfig.fetch].filter(
      (v) => v !== undefined,
    ).length;
    if (authSources !== 1) {
      throw new Error(
        'Mediforce: provide exactly one of `apiKey`, `bearerToken`, or `fetch`. ' +
          'Use `apiKey` for server-to-server, `bearerToken` for user sessions, ' +
          '`fetch` for tests (loopback) or custom wrappers that bake auth into the closure.',
      );
    }
    // apiKey implies server-to-server, which always needs an absolute target.
    // Same-origin browser calls use bearerToken, not apiKey, so requiring
    // baseUrl here trades zero flexibility for one less silent failure in
    // Node ("Invalid URL" from `fetch('/api/...')` is not obviously a config
    // mistake at the call site).
    if (safeConfig.apiKey !== undefined) {
      const baseUrl = (config as BaseClientConfig).baseUrl;
      if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        throw new Error(
          'Mediforce: `apiKey` requires a non-empty `baseUrl` (server-to-server calls need an absolute target). ' +
            'Example: new Mediforce({ apiKey, baseUrl: "https://mediforce.example.com" }).',
        );
      }
    }

    this.tasks = {
      list: async (input) => {
        const validated = ListTasksInputSchema.parse(input);
        const qs = toSearchParams({
          instanceId: validated.instanceId,
          role: validated.role,
          stepId: validated.stepId,
          status: validated.status,
        });
        const res = await this.request(`/api/tasks${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.tasks.list');
        return ListTasksOutputSchema.parse(body);
      },
    };

    this.workflows = {
      register: async (input, options) => {
        const validatedInput = RegisterWorkflowInputSchema.parse(input);
        const namespace = options.namespace;
        if (typeof namespace !== 'string' || namespace.length === 0) {
          throw new Error(
            'mediforce.workflows.register: `namespace` is required (passed as an HTTP query parameter).',
          );
        }
        const qs = toSearchParams({ namespace });
        const res = await this.request(`/api/workflow-definitions${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validatedInput),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.register');
        return RegisterWorkflowOutputSchema.parse(body);
      },
      list: async () => {
        const res = await this.request('/api/workflow-definitions');
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.list');
        return ListWorkflowsOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetWorkflowInputSchema.parse(input);
        const qs = toSearchParams({
          version: validated.version !== undefined ? String(validated.version) : undefined,
        });
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.get');
        return GetWorkflowOutputSchema.parse(body);
      },
    };

    this.runs = {
      list: async (input) => {
        const validated = ListRunsInputSchema.parse(input ?? {});
        const qs = toSearchParams({
          workflow: validated.workflow,
          status: validated.status,
          limit: validated.limit !== undefined ? String(validated.limit) : undefined,
        });
        const res = await this.request(`/api/runs${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.runs.list');
        return ListRunsOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetRunInputSchema.parse(input);
        const res = await this.request(
          `/api/runs/${encodeURIComponent(validated.runId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.runs.get');
        return GetRunOutputSchema.parse(body);
      },
      start: async (input) => {
        const validated = StartRunInputSchema.parse(input);
        const res = await this.request('/api/processes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validated),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.runs.start');
        return StartRunOutputSchema.parse(body);
      },
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const authHeaders = await this.buildAuthHeaders();
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(authHeaders)) {
      if (!headers.has(key)) headers.set(key, value);
    }
    const base = this.config.baseUrl ?? '';
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    return fetchImpl(`${base}${path}`, { ...init, headers });
  }

  private async buildAuthHeaders(): Promise<Record<string, string>> {
    if (this.config.apiKey !== undefined) {
      return { 'X-Api-Key': this.config.apiKey };
    }
    if (this.config.bearerToken !== undefined) {
      const token = await this.config.bearerToken();
      return token === null ? {} : { Authorization: `Bearer ${token}` };
    }
    return {};
  }
}

function toSearchParams(
  input: Record<string, string | readonly string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value as string);
    }
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

async function parseJsonOrThrow(res: Response, context: string): Promise<unknown> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${context} failed with status ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return body;
}
