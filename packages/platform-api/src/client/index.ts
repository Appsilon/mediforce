import {
  ListTasksInputSchema,
  ListTasksOutputSchema,
  GetTaskInputSchema,
  GetTaskOutputSchema,
  RegisterWorkflowInputSchema,
  RegisterWorkflowOutputSchema,
  ListWorkflowsInputSchema,
  ListWorkflowsOutputSchema,
  GetWorkflowInputSchema,
  GetWorkflowOutputSchema,
  GetRunInputSchema,
  GetRunOutputSchema,
  StartRunInputSchema,
  StartRunOutputSchema,
  ListRunsInputSchema,
  ListRunsOutputSchema,
  ArchiveVersionInputSchema,
  ArchiveVersionOutputSchema,
  ArchiveAllInputSchema,
  ArchiveAllOutputSchema,
  SetVisibilityInputSchema,
  SetVisibilityOutputSchema,
  CopyWorkflowInputSchema,
  CopyWorkflowOutputSchema,
  DockerInfoResponseSchema,
  RemoveImageOutputSchema,
  OpenRouterCreditsInputSchema,
  OpenRouterCreditsOutputSchema,
  ListAgentsInputSchema,
  ListAgentsOutputSchema,
  GetAgentInputSchema,
  GetAgentOutputSchema,
  DeleteAgentInputSchema,
  DeleteAgentOutputSchema,
  UpdateAgentInputSchema,
  UpdateAgentBodySchema,
  UpdateAgentOutputSchema,
  SetSecretInputSchema,
  SetSecretOutputSchema,
  ListSecretKeysInputSchema,
  ListSecretKeysOutputSchema,
  DeleteSecretInputSchema,
  DeleteSecretOutputSchema,
  GetProcessInputSchema,
  GetProcessOutputSchema,
  ListAuditEventsInputSchema,
  ListAuditEventsOutputSchema,
  GetProcessStepsInputSchema,
  GetProcessStepsOutputSchema,
  GetCoworkSessionInputSchema,
  GetCoworkSessionOutputSchema,
  GetCoworkSessionByInstanceInputSchema,
  GetCoworkSessionByInstanceOutputSchema,
  ChatCoworkSessionInputSchema,
  ChatCoworkSessionOutputSchema,
  FinalizeCoworkSessionInputSchema,
  FinalizeCoworkSessionOutputSchema,
  CreateVoiceEphemeralKeyInputSchema,
  CreateVoiceEphemeralKeyOutputSchema,
  SynthesizeVoiceArtifactInputSchema,
  SynthesizeVoiceArtifactOutputSchema,
  ListPluginsOutputSchema,
  ClaimTaskInputSchema,
  ClaimTaskOutputSchema,
  CompleteTaskInputSchema,
  CompleteTaskOutputSchema,
  CancelRunInputSchema,
  CancelRunOutputSchema,
  ResumeRunInputSchema,
  ResumeRunOutputSchema,
  RetryStepInputSchema,
  RetryStepOutputSchema,
  HeartbeatInputSchema,
  HeartbeatOutputSchema,
  type ListTasksInput,
  type ListTasksOutput,
  type GetTaskInput,
  type GetTaskOutput,
  type ClaimTaskInput,
  type ClaimTaskOutput,
  type CompleteTaskInput,
  type CompleteTaskOutput,
  type RegisterWorkflowInput,
  type RegisterWorkflowOutput,
  type RegisterWorkflowOptions,
  type ListWorkflowsInput,
  type ListWorkflowsOutput,
  type GetWorkflowInput,
  type GetWorkflowOutput,
  type ArchiveVersionInput,
  type ArchiveVersionOutput,
  type ArchiveAllInput,
  type ArchiveAllOutput,
  type SetVisibilityInput,
  type SetVisibilityOutput,
  type CopyWorkflowInput,
  type CopyWorkflowOutput,
  type CopyWorkflowOptions,
  type GetRunInput,
  type GetRunOutput,
  type StartRunInput,
  type StartRunOutput,
  type ListRunsInput,
  type ListRunsOutput,
  type DockerInfoResponse,
  type RemoveImageOutput,
  type OpenRouterCreditsInput,
  type OpenRouterCreditsOutput,
  type ListAgentsInput,
  type ListAgentsOutput,
  type GetAgentInput,
  type GetAgentOutput,
  type DeleteAgentInput,
  type DeleteAgentOutput,
  type UpdateAgentInput,
  type UpdateAgentBody,
  type UpdateAgentOutput,
  type SetSecretInput,
  type SetSecretOutput,
  type ListSecretKeysInput,
  type ListSecretKeysOutput,
  type DeleteSecretInput,
  type DeleteSecretOutput,
  ListModelsInputSchema,
  ListModelsOutputSchema,
  GetModelInputSchema,
  GetModelOutputSchema,
  SyncModelsOutputSchema,
  type ListModelsInput,
  type ListModelsOutput,
  type GetModelInput,
  type GetModelOutput,
  type SyncModelsOutput,
  type GetProcessInput,
  type GetProcessOutput,
  type ListAuditEventsInput,
  type ListAuditEventsOutput,
  type GetProcessStepsInput,
  type GetProcessStepsOutput,
  type CancelRunInput,
  type CancelRunOutput,
  type ResumeRunInput,
  type ResumeRunOutput,
  type RetryStepInput,
  type RetryStepOutput,
  type HeartbeatInput,
  type HeartbeatOutput,
  type GetCoworkSessionInput,
  type GetCoworkSessionOutput,
  type GetCoworkSessionByInstanceInput,
  type GetCoworkSessionByInstanceOutput,
  type ChatCoworkSessionInput,
  type ChatCoworkSessionOutput,
  type FinalizeCoworkSessionInput,
  type FinalizeCoworkSessionOutput,
  type CreateVoiceEphemeralKeyInput,
  type CreateVoiceEphemeralKeyOutput,
  type SynthesizeVoiceArtifactInput,
  type SynthesizeVoiceArtifactOutput,
  type ListPluginsOutput,
} from '../contract/index.js';
// SDK consumers reach for one path:
//   import { Mediforce, ApiError, type ApiErrorCode } from '@mediforce/platform-api/client';
// Server-side handlers throw `HandlerError` (or subclasses) imported from
// `@mediforce/platform-api/errors`; the wire envelope is the only shared
// surface, so the client just exposes `code`/`details` on `ApiError` directly.
import { ApiErrorEnvelopeSchema, type ApiErrorCode } from '../errors.js';
export type { ApiErrorCode };

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

// Transport-aware error wrapper. Holds HTTP `status` + raw `body` plus the
// parsed envelope fields (`code`, `details`) when the server returned the
// ADR-0005 §1 typed envelope. `code` is `undefined` for legacy / network /
// non-JSON responses.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
    public readonly code?: ApiErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class Mediforce {
  readonly tasks: {
    list: (input: ListTasksInput) => Promise<ListTasksOutput>;
    get: (input: GetTaskInput) => Promise<GetTaskOutput>;
    claim: (input: ClaimTaskInput) => Promise<ClaimTaskOutput>;
    complete: (input: CompleteTaskInput) => Promise<CompleteTaskOutput>;
  };

  readonly processes: {
    get: (input: GetProcessInput) => Promise<GetProcessOutput>;
    listAuditEvents: (input: ListAuditEventsInput) => Promise<ListAuditEventsOutput>;
    getSteps: (input: GetProcessStepsInput) => Promise<GetProcessStepsOutput>;
  };

  readonly cowork: {
    get: (input: GetCoworkSessionInput) => Promise<GetCoworkSessionOutput>;
    getByInstance: (
      input: GetCoworkSessionByInstanceInput,
    ) => Promise<GetCoworkSessionByInstanceOutput>;
    chat: (input: ChatCoworkSessionInput) => Promise<ChatCoworkSessionOutput>;
    finalize: (
      input: FinalizeCoworkSessionInput,
    ) => Promise<FinalizeCoworkSessionOutput>;
    voiceEphemeralKey: (
      input: CreateVoiceEphemeralKeyInput,
    ) => Promise<CreateVoiceEphemeralKeyOutput>;
    voiceSynthesize: (
      input: SynthesizeVoiceArtifactInput,
    ) => Promise<SynthesizeVoiceArtifactOutput>;
  };

  readonly plugins: {
    list: () => Promise<ListPluginsOutput>;
  };

  readonly workflows: {
    register: (
      input: RegisterWorkflowInput,
      options: RegisterWorkflowOptions,
    ) => Promise<RegisterWorkflowOutput>;
    list: (input?: ListWorkflowsInput) => Promise<ListWorkflowsOutput>;
    get: (input: GetWorkflowInput) => Promise<GetWorkflowOutput>;
    archiveVersion: (input: ArchiveVersionInput) => Promise<ArchiveVersionOutput>;
    archiveAll: (input: ArchiveAllInput) => Promise<ArchiveAllOutput>;
    setVisibility: (input: SetVisibilityInput) => Promise<SetVisibilityOutput>;
    copy: (input: CopyWorkflowInput, options: CopyWorkflowOptions) => Promise<CopyWorkflowOutput>;
  };

  readonly runs: {
    list: (input?: ListRunsInput) => Promise<ListRunsOutput>;
    get: (input: GetRunInput) => Promise<GetRunOutput>;
    start: (input: StartRunInput) => Promise<StartRunOutput>;
    cancel: (input: CancelRunInput) => Promise<CancelRunOutput>;
    resume: (input: ResumeRunInput) => Promise<ResumeRunOutput>;
    retryStep: (input: RetryStepInput) => Promise<RetryStepOutput>;
  };

  readonly agents: {
    list: (input?: ListAgentsInput) => Promise<ListAgentsOutput>;
    get: (input: GetAgentInput) => Promise<GetAgentOutput>;
    delete: (input: DeleteAgentInput) => Promise<DeleteAgentOutput>;
    update: (input: UpdateAgentInput, body: UpdateAgentBody) => Promise<UpdateAgentOutput>;
  };

  readonly models: {
    list: (input?: ListModelsInput) => Promise<ListModelsOutput>;
    get: (input: GetModelInput) => Promise<GetModelOutput>;
    sync: () => Promise<SyncModelsOutput>;
  };

  readonly secrets: {
    set: (input: SetSecretInput) => Promise<SetSecretOutput>;
    list: (input: ListSecretKeysInput) => Promise<ListSecretKeysOutput>;
    delete: (input: DeleteSecretInput) => Promise<DeleteSecretOutput>;
  };

  readonly system: {
    dockerInfo: () => Promise<DockerInfoResponse>;
    removeImage: (imageId: string) => Promise<RemoveImageOutput>;
    credits: (input: OpenRouterCreditsInput) => Promise<OpenRouterCreditsOutput>;
  };

  readonly cron: {
    heartbeat: (input?: HeartbeatInput) => Promise<HeartbeatOutput>;
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
      get: async (input) => {
        const validated = GetTaskInputSchema.parse(input);
        const res = await this.request(
          `/api/tasks/${encodeURIComponent(validated.taskId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.tasks.get');
        return GetTaskOutputSchema.parse(body);
      },
      claim: async (input) => {
        const validated = ClaimTaskInputSchema.parse(input);
        const res = await this.request(
          `/api/tasks/${encodeURIComponent(validated.taskId)}/claim`,
          { method: 'POST' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.tasks.claim');
        return ClaimTaskOutputSchema.parse(body);
      },
      complete: async (input) => {
        const validated = CompleteTaskInputSchema.parse(input);
        const res = await this.request(
          `/api/tasks/${encodeURIComponent(validated.taskId)}/complete`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validated.payload),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.tasks.complete');
        return CompleteTaskOutputSchema.parse(body);
      },
    };

    this.processes = {
      get: async (input) => {
        const validated = GetProcessInputSchema.parse(input);
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.instanceId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.processes.get');
        return GetProcessOutputSchema.parse(body);
      },
      listAuditEvents: async (input) => {
        const validated = ListAuditEventsInputSchema.parse(input);
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.instanceId)}/audit`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.processes.listAuditEvents');
        return ListAuditEventsOutputSchema.parse(body);
      },
      getSteps: async (input) => {
        const validated = GetProcessStepsInputSchema.parse(input);
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.instanceId)}/steps`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.processes.getSteps');
        return GetProcessStepsOutputSchema.parse(body);
      },
    };

    this.cowork = {
      get: async (input) => {
        const validated = GetCoworkSessionInputSchema.parse(input);
        const res = await this.request(
          `/api/cowork/${encodeURIComponent(validated.sessionId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.get');
        return GetCoworkSessionOutputSchema.parse(body);
      },
      getByInstance: async (input) => {
        const validated = GetCoworkSessionByInstanceInputSchema.parse(input);
        const res = await this.request(
          `/api/cowork/by-instance/${encodeURIComponent(validated.instanceId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.getByInstance');
        return GetCoworkSessionByInstanceOutputSchema.parse(body);
      },
      chat: async (input) => {
        const validated = ChatCoworkSessionInputSchema.parse(input);
        const res = await this.request(
          `/api/cowork/${encodeURIComponent(validated.sessionId)}/chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: validated.message }),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.chat');
        return ChatCoworkSessionOutputSchema.parse(body);
      },
      finalize: async (input) => {
        const validated = FinalizeCoworkSessionInputSchema.parse(input);
        const res = await this.request(
          `/api/cowork/${encodeURIComponent(validated.sessionId)}/finalize`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artifact: validated.artifact }),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.finalize');
        return FinalizeCoworkSessionOutputSchema.parse(body);
      },
      voiceEphemeralKey: async (input) => {
        const validated = CreateVoiceEphemeralKeyInputSchema.parse(input);
        const res = await this.request(
          `/api/cowork/${encodeURIComponent(validated.sessionId)}/voice/ephemeral-key`,
          { method: 'POST' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.voiceEphemeralKey');
        return CreateVoiceEphemeralKeyOutputSchema.parse(body);
      },
      voiceSynthesize: async (input) => {
        const validated = SynthesizeVoiceArtifactInputSchema.parse(input);
        const res = await this.request(
          `/api/cowork/${encodeURIComponent(validated.sessionId)}/voice/synthesize`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript: validated.transcript,
              comment: validated.comment,
            }),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.voiceSynthesize');
        return SynthesizeVoiceArtifactOutputSchema.parse(body);
      },
    };

    this.plugins = {
      list: async () => {
        const res = await this.request('/api/plugins');
        const body = await parseJsonOrThrow(res, 'mediforce.plugins.list');
        return ListPluginsOutputSchema.parse(body);
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
      list: async (input) => {
        const validated = input ? ListWorkflowsInputSchema.parse(input) : undefined;
        const qs = validated
          ? toSearchParams({ namespace: validated.namespace })
          : '';
        const res = await this.request(`/api/workflow-definitions${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.list');
        return ListWorkflowsOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetWorkflowInputSchema.parse(input);
        const qs = toSearchParams({
          version: validated.version !== undefined ? String(validated.version) : undefined,
          namespace: validated.namespace,
        });
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.get');
        return GetWorkflowOutputSchema.parse(body);
      },
      archiveVersion: async (input) => {
        const validated = ArchiveVersionInputSchema.parse(input);
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/versions/${validated.version}/archive`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: validated.archived }),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.archiveVersion');
        return ArchiveVersionOutputSchema.parse(body);
      },
      archiveAll: async (input) => {
        const validated = ArchiveAllInputSchema.parse(input);
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/archive`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: validated.archived }),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.archiveAll');
        return ArchiveAllOutputSchema.parse(body);
      },
      setVisibility: async (input) => {
        const validated = SetVisibilityInputSchema.parse(input);
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visibility: validated.visibility }),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.setVisibility');
        return SetVisibilityOutputSchema.parse(body);
      },
      copy: async (input, options) => {
        const validated = CopyWorkflowInputSchema.parse(input);
        const qs = toSearchParams({ targetNamespace: options.targetNamespace });
        const reqBody: Record<string, unknown> = {};
        if (validated.version !== undefined) reqBody.version = validated.version;
        if (validated.targetName !== undefined) reqBody.targetName = validated.targetName;
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/copy${qs}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.copy');
        return CopyWorkflowOutputSchema.parse(body);
      },
    };

    this.agents = {
      list: async () => {
        const res = await this.request('/api/agents');
        const body = await parseJsonOrThrow(res, 'mediforce.agents.list');
        return ListAgentsOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetAgentInputSchema.parse(input);
        const res = await this.request(
          `/api/agents/${encodeURIComponent(validated.id)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agents.get');
        return GetAgentOutputSchema.parse(body);
      },
      delete: async (input) => {
        const validated = DeleteAgentInputSchema.parse(input);
        const res = await this.request(
          `/api/agents/${encodeURIComponent(validated.id)}`,
          { method: 'DELETE' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agents.delete');
        return DeleteAgentOutputSchema.parse(body);
      },
      update: async (input, updateBody) => {
        const validatedInput = UpdateAgentInputSchema.parse(input);
        const validatedBody = UpdateAgentBodySchema.parse(updateBody);
        const res = await this.request(
          `/api/agents/${encodeURIComponent(validatedInput.id)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validatedBody),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agents.update');
        return UpdateAgentOutputSchema.parse(body);
      },
    };

    this.models = {
      list: async (input) => {
        const validated = input ? ListModelsInputSchema.parse(input) : undefined;
        const qs = validated
          ? toSearchParams({
              provider: validated.provider,
              supportsTools: validated.supportsTools !== undefined ? String(validated.supportsTools) : undefined,
              supportsVision: validated.supportsVision !== undefined ? String(validated.supportsVision) : undefined,
              minContextLength: validated.minContextLength !== undefined ? String(validated.minContextLength) : undefined,
            })
          : '';
        const res = await this.request(`/api/model-registry${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.models.list');
        return ListModelsOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetModelInputSchema.parse(input);
        const res = await this.request(
          `/api/model-registry/${encodeURIComponent(validated.id)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.models.get');
        return GetModelOutputSchema.parse(body);
      },
      sync: async () => {
        const res = await this.request('/api/model-registry/sync', { method: 'POST' });
        const body = await parseJsonOrThrow(res, 'mediforce.models.sync');
        return SyncModelsOutputSchema.parse(body);
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
      cancel: async (input) => {
        const validated = CancelRunInputSchema.parse(input);
        const body = validated.reason !== undefined ? { reason: validated.reason } : {};
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.runId)}/cancel`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const parsed = await parseJsonOrThrow(res, 'mediforce.runs.cancel');
        return CancelRunOutputSchema.parse(parsed);
      },
      resume: async (input) => {
        const validated = ResumeRunInputSchema.parse(input);
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.runId)}/resume`,
          { method: 'POST' },
        );
        const parsed = await parseJsonOrThrow(res, 'mediforce.runs.resume');
        return ResumeRunOutputSchema.parse(parsed);
      },
      retryStep: async (input) => {
        const validated = RetryStepInputSchema.parse(input);
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.runId)}/steps/${encodeURIComponent(validated.stepId)}/retry`,
          { method: 'POST' },
        );
        const parsed = await parseJsonOrThrow(res, 'mediforce.runs.retryStep');
        return RetryStepOutputSchema.parse(parsed);
      },
    };

    this.secrets = {
      set: async (input) => {
        const validated = SetSecretInputSchema.parse(input);
        const params: Record<string, string> = { namespace: validated.namespace };
        if (validated.workflow) params.workflow = validated.workflow;
        const qs = toSearchParams(params);
        const res = await this.request(`/api/workflow-secrets${qs}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: validated.key, value: validated.value }),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.secrets.set');
        return SetSecretOutputSchema.parse(body);
      },
      list: async (input) => {
        const validated = ListSecretKeysInputSchema.parse(input);
        const params: Record<string, string> = { namespace: validated.namespace };
        if (validated.workflow) params.workflow = validated.workflow;
        const qs = toSearchParams(params);
        const res = await this.request(`/api/workflow-secrets${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.secrets.list');
        return ListSecretKeysOutputSchema.parse(body);
      },
      delete: async (input) => {
        const validated = DeleteSecretInputSchema.parse(input);
        const params: Record<string, string> = { namespace: validated.namespace, key: validated.key };
        if (validated.workflow) params.workflow = validated.workflow;
        const qs = toSearchParams(params);
        const res = await this.request(`/api/workflow-secrets${qs}`, { method: 'DELETE' });
        const body = await parseJsonOrThrow(res, 'mediforce.secrets.delete');
        return DeleteSecretOutputSchema.parse(body);
      },
    };

    this.system = {
      dockerInfo: async () => {
        const res = await this.request('/api/system/docker-info');
        const body = await parseJsonOrThrow(res, 'mediforce.system.dockerInfo');
        return DockerInfoResponseSchema.parse(body);
      },
      removeImage: async (imageId: string) => {
        const res = await this.request('/api/admin/docker-images', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId }),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.system.removeImage');
        return RemoveImageOutputSchema.parse(body);
      },
      credits: async (input: OpenRouterCreditsInput) => {
        const validated = OpenRouterCreditsInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/system/openrouter-credits${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.system.credits');
        return OpenRouterCreditsOutputSchema.parse(body);
      },
    };

    this.cron = {
      heartbeat: async (input) => {
        HeartbeatInputSchema.parse(input ?? {});
        const res = await this.request('/api/cron/heartbeat', { method: 'POST' });
        const body = await parseJsonOrThrow(res, 'mediforce.cron.heartbeat');
        return HeartbeatOutputSchema.parse(body);
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
    const extracted = extractErrorEnvelope(body);
    const message = extracted.message ?? `${context} failed with status ${res.status}`;
    throw new ApiError(res.status, message, body, extracted.code, extracted.details);
  }
  return body;
}

/**
 * Pull the error message out of the response body. Supports both shapes:
 *   - ADR-0005 §1 typed envelope: `{ error: { code, message, details? } }`
 *   - Legacy string envelope: `{ error: string }` (Phase 1 routes that
 *     haven't migrated to the typed adapter yet).
 *
 * The legacy branch will go away when every route is on `createRouteAdapter`,
 * but until then both must round-trip cleanly through the client.
 *
 * The `code` cast is honest for known codes — unknown server codes (version
 * drift) flow through as `ApiErrorCode` strings the client doesn't recognise.
 * Callers comparing `err.code === 'not_found'` simply miss; they don't crash.
 */
function extractErrorEnvelope(body: unknown): {
  message?: string;
  code?: ApiErrorCode;
  details?: unknown;
} {
  const parsed = ApiErrorEnvelopeSchema.safeParse(body);
  if (!parsed.success) return {};
  const { error } = parsed.data;
  if (typeof error === 'string') return { message: error };
  return { message: error.message, code: error.code as ApiErrorCode, details: error.details };
}
