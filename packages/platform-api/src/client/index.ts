import {
  ListTasksInputSchema,
  ListTasksOutputSchema,
  GetTaskInputSchema,
  GetTaskOutputSchema,
  RegisterWorkflowInputSchema,
  RegisterWorkflowOutputSchema,
  ValidateWorkflowOutputSchema,
  GetWorkflowSchemaOutputSchema,
  ListWorkflowsInputSchema,
  ListWorkflowsOutputSchema,
  GetWorkflowInputSchema,
  GetWorkflowOutputSchema,
  ListWorkflowVersionsInputSchema,
  ListWorkflowVersionsOutputSchema,
  GetRunInputSchema,
  GetRunOutputSchema,
  StartRunInputSchema,
  StartRunOutputSchema,
  ListRunsInputSchema,
  ListRunsOutputSchema,
  ListRunNamesInputSchema,
  ListRunNamesOutputSchema,
  ListRunOutputFilesInputSchema,
  ListRunOutputFilesOutputSchema,
  DownloadRunOutputFileInputSchema,
  DownloadOutputFilesArchiveInputSchema,
  ArchiveVersionInputSchema,
  ArchiveVersionOutputSchema,
  ArchiveAllInputSchema,
  ArchiveAllOutputSchema,
  SetVisibilityInputSchema,
  SetVisibilityOutputSchema,
  CopyWorkflowInputSchema,
  CopyWorkflowOutputSchema,
  SetDefaultVersionInputSchema,
  SetDefaultVersionOutputSchema,
  DeleteWorkflowInputSchema,
  DeleteWorkflowOutputSchema,
  GetWorkflowRunCountInputSchema,
  GetWorkflowRunCountOutputSchema,
  TransferWorkflowInputSchema,
  TransferWorkflowOutputSchema,
  ImportWorkflowInputSchema,
  GetManifestInputSchema,
  GetManifestOutputSchema,
  ListTriggersInputSchema,
  ListTriggersOutputSchema,
  CreateTriggerInputSchema,
  CreateTriggerOutputSchema,
  UpdateTriggerInputSchema,
  UpdateTriggerOutputSchema,
  SetTriggerEnabledInputSchema,
  SetTriggerEnabledOutputSchema,
  DeleteTriggerInputSchema,
  DeleteTriggerOutputSchema,
  DockerInfoResponseSchema,
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
  CreateAgentInputSchema,
  CreateAgentOutputSchema,
  UpsertAgentMcpBindingInputSchema,
  UpsertAgentMcpBindingOutputSchema,
  DeleteAgentMcpBindingInputSchema,
  DeleteAgentMcpBindingOutputSchema,
  ListAgentMcpBindingsInputSchema,
  ListAgentMcpBindingsOutputSchema,
  ListAgentOAuthTokensInputSchema,
  ListAgentOAuthTokensOutputSchema,
  GetAgentOAuthTokenInputSchema,
  GetAgentOAuthTokenOutputSchema,
  DeleteAgentOAuthTokenInputSchema,
  DeleteAgentOAuthTokenOutputSchema,
  SetSecretInputSchema,
  SetSecretOutputSchema,
  ListSecretKeysInputSchema,
  ListSecretKeysOutputSchema,
  DeleteSecretInputSchema,
  DeleteSecretOutputSchema,
  GetWorkspaceSecretPreviewsInputSchema,
  GetWorkspaceSecretPreviewsOutputSchema,
  ListWorkflowSecretKeysBatchInputSchema,
  ListWorkflowSecretKeysBatchOutputSchema,
  GetWorkflowSecretsFullInputSchema,
  GetWorkflowSecretsFullOutputSchema,
  SaveWorkflowSecretsInputSchema,
  SaveWorkflowSecretsOutputSchema,
  GetProcessInputSchema,
  GetProcessOutputSchema,
  ListAuditEventsInputSchema,
  ListAuditEventsOutputSchema,
  ListAgentEventsInputSchema,
  ListAgentEventsOutputSchema,
  GetProcessStepsInputSchema,
  GetProcessStepsOutputSchema,
  GetCoworkSessionInputSchema,
  GetCoworkSessionOutputSchema,
  GetCoworkSessionByInstanceInputSchema,
  GetCoworkSessionByInstanceOutputSchema,
  ListCoworkSessionsInputSchema,
  ListCoworkSessionsOutputSchema,
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
  ListAttachmentsInputSchema,
  ListAttachmentsOutputSchema,
  UploadAttachmentOutputSchema,
  DeleteAttachmentInputSchema,
  DeleteAttachmentOutputSchema,
  type ListAttachmentsInput,
  type ListAttachmentsOutput,
  type UploadAttachmentOutput,
  type DeleteAttachmentInput,
  type DeleteAttachmentOutput,
  CancelRunInputSchema,
  CancelRunOutputSchema,
  ResumeRunInputSchema,
  ResumeRunOutputSchema,
  RetryStepInputSchema,
  RetryStepOutputSchema,
  ArchiveRunInputSchema,
  ArchiveRunOutputSchema,
  BulkRunInputSchema,
  BulkRunOutputSchema,
  HeartbeatInputSchema,
  HeartbeatOutputSchema,
  ListOAuthProvidersInputSchema,
  ListOAuthProvidersOutputSchema,
  GetOAuthProviderInputSchema,
  GetOAuthProviderOutputSchema,
  CreateOAuthProviderInputApiSchema,
  CreateOAuthProviderOutputSchema,
  UpdateOAuthProviderInputApiSchema,
  UpdateOAuthProviderOutputSchema,
  DeleteOAuthProviderInputSchema,
  DeleteOAuthProviderOutputSchema,
  ListToolCatalogEntriesInputSchema,
  ListToolCatalogEntriesOutputSchema,
  GetToolCatalogEntryInputSchema,
  GetToolCatalogEntryOutputSchema,
  CreateToolCatalogEntryInputApiSchema,
  CreateToolCatalogEntryOutputSchema,
  UpdateToolCatalogEntryInputApiSchema,
  UpdateToolCatalogEntryOutputSchema,
  DeleteToolCatalogEntryInputSchema,
  DeleteToolCatalogEntryOutputSchema,
  ListNamespaceMembersInputSchema,
  ListNamespaceMembersOutputSchema,
  InviteUserInputSchema,
  InviteUserOutputSchema,
  ResendInviteInputSchema,
  ResendInviteOutputSchema,
  GetMeInputSchema,
  GetMeOutputSchema,
  ClearMustChangePasswordInputSchema,
  ClearMustChangePasswordOutputSchema,
  SetPasswordInputSchema,
  SetPasswordOutputSchema,
  GetNamespaceInputSchema,
  GetNamespaceOutputSchema,
  CreateNamespaceInputSchema,
  CreateNamespaceOutputSchema,
  UpdateNamespaceInputSchema,
  UpdateNamespaceBodySchema,
  UpdateNamespaceOutputSchema,
  DeleteNamespaceInputSchema,
  DeleteNamespaceOutputSchema,
  LeaveNamespaceInputSchema,
  LeaveNamespaceOutputSchema,
  RemoveNamespaceMemberInputSchema,
  RemoveNamespaceMemberOutputSchema,
  UpdateNamespaceMemberRoleInputSchema,
  UpdateNamespaceMemberRoleBodySchema,
  UpdateNamespaceMemberRoleOutputSchema,
  type ListNamespaceMembersInput,
  type ListNamespaceMembersOutput,
  type InviteUserInput,
  type InviteUserOutput,
  type ResendInviteInput,
  type ResendInviteOutput,
  type GetMeInput,
  type GetMeOutput,
  type ClearMustChangePasswordInput,
  type ClearMustChangePasswordOutput,
  type SetPasswordInput,
  type SetPasswordOutput,
  type GetNamespaceInput,
  type GetNamespaceOutput,
  type CreateNamespaceInput,
  type CreateNamespaceOutput,
  type UpdateNamespaceInput,
  type UpdateNamespaceOutput,
  type DeleteNamespaceInput,
  type DeleteNamespaceOutput,
  type LeaveNamespaceInput,
  type LeaveNamespaceOutput,
  type RemoveNamespaceMemberInput,
  type RemoveNamespaceMemberOutput,
  type UpdateNamespaceMemberRoleInput,
  type UpdateNamespaceMemberRoleOutput,
  DeleteDockerImageInputSchema,
  DeleteDockerImageOutputSchema,
  type DeleteDockerImageInput,
  type DeleteDockerImageOutput,
  type ListOAuthProvidersInput,
  type ListOAuthProvidersOutput,
  type GetOAuthProviderInput,
  type GetOAuthProviderOutput,
  type CreateOAuthProviderInputApi,
  type CreateOAuthProviderOutput,
  type UpdateOAuthProviderInputApi,
  type UpdateOAuthProviderOutput,
  type DeleteOAuthProviderInput,
  type DeleteOAuthProviderOutput,
  type ListToolCatalogEntriesInput,
  type ListToolCatalogEntriesOutput,
  type GetToolCatalogEntryInput,
  type GetToolCatalogEntryOutput,
  type CreateToolCatalogEntryInputApi,
  type CreateToolCatalogEntryOutput,
  type UpdateToolCatalogEntryInputApi,
  type UpdateToolCatalogEntryOutput,
  type DeleteToolCatalogEntryInput,
  type DeleteToolCatalogEntryOutput,
  type ListTasksInput,
  type ListTasksOutput,
  type GetTaskInput,
  type GetTaskOutput,
  type ClaimTaskInput,
  type ClaimTaskOutput,
  type CompleteTaskInput,
  type CompleteTaskOutput,
  type RegisterWorkflowBody,
  type RegisterWorkflowOutput,
  type RegisterWorkflowOptions,
  type ValidateWorkflowInput,
  type ValidateWorkflowOutput,
  type GetWorkflowSchemaOutput,
  type ListWorkflowsRequest,
  type ListWorkflowsOutput,
  type GetWorkflowInput,
  type GetWorkflowOutput,
  type ListWorkflowVersionsInput,
  type ListWorkflowVersionsOutput,
  type ArchiveVersionInput,
  type ArchiveVersionOutput,
  type ArchiveAllInput,
  type ArchiveAllOutput,
  type SetVisibilityInput,
  type SetVisibilityOutput,
  type CopyWorkflowInput,
  type CopyWorkflowOutput,
  type CopyWorkflowOptions,
  type SetDefaultVersionInput,
  type SetDefaultVersionOutput,
  type DeleteWorkflowInput,
  type DeleteWorkflowOutput,
  type GetWorkflowRunCountInput,
  type GetWorkflowRunCountOutput,
  type TransferWorkflowInput,
  type TransferWorkflowOutput,
  type ImportWorkflowInput,
  type ImportWorkflowOutput,
  type GetManifestInput,
  type GetManifestOutput,
  type ListTriggersInput,
  type ListTriggersOutput,
  type CreateTriggerInput,
  type CreateTriggerOutput,
  type UpdateTriggerInput,
  type UpdateTriggerOutput,
  type SetTriggerEnabledInput,
  type SetTriggerEnabledOutput,
  type DeleteTriggerInput,
  type DeleteTriggerOutput,
  type GetRunInput,
  type GetRunOutput,
  type StartRunInput,
  type StartRunOutput,
  type ListRunsInput,
  type ListRunsOutput,
  type ListRunNamesInput,
  type ListRunNamesOutput,
  type ListRunOutputFilesInput,
  type ListRunOutputFilesOutput,
  type DownloadRunOutputFileInput,
  type DownloadOutputFilesArchiveInput,
  type DockerInfoResponse,
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
  type CreateAgentBody,
  type CreateAgentOutput,
  type UpsertAgentMcpBindingInput,
  type UpsertAgentMcpBindingOutput,
  type DeleteAgentMcpBindingInput,
  type DeleteAgentMcpBindingOutput,
  type ListAgentMcpBindingsInput,
  type ListAgentMcpBindingsOutput,
  type ListAgentOAuthTokensInput,
  type ListAgentOAuthTokensOutput,
  type GetAgentOAuthTokenInput,
  type GetAgentOAuthTokenOutput,
  type DeleteAgentOAuthTokenInput,
  type DeleteAgentOAuthTokenOutput,
  type SetSecretInput,
  type SetSecretOutput,
  type ListSecretKeysInput,
  type ListSecretKeysOutput,
  type DeleteSecretInput,
  type DeleteSecretOutput,
  type GetWorkspaceSecretPreviewsInput,
  type GetWorkspaceSecretPreviewsOutput,
  type ListWorkflowSecretKeysBatchInput,
  type ListWorkflowSecretKeysBatchOutput,
  type GetWorkflowSecretsFullInput,
  type GetWorkflowSecretsFullOutput,
  type SaveWorkflowSecretsInput,
  type SaveWorkflowSecretsOutput,
  ListModelsInputSchema,
  ListModelsOutputSchema,
  GetModelInputSchema,
  GetModelOutputSchema,
  SyncModelsOutputSchema,
  ValidateModelsInputSchema,
  ValidateModelsOutputSchema,
  type ListModelsInput,
  type ListModelsOutput,
  type GetModelInput,
  type GetModelOutput,
  type SyncModelsOutput,
  type ValidateModelsInput,
  type ValidateModelsOutput,
  type GetProcessInput,
  type GetProcessOutput,
  type ListAuditEventsInput,
  type ListAuditEventsOutput,
  type ListAgentEventsInput,
  type ListAgentEventsOutput,
  type GetProcessStepsInput,
  type GetProcessStepsOutput,
  type CancelRunInput,
  type CancelRunOutput,
  type ResumeRunInput,
  type ResumeRunOutput,
  type RetryStepInput,
  type RetryStepOutput,
  type ArchiveRunInput,
  type ArchiveRunOutput,
  type BulkRunInput,
  type BulkRunOutput,
  type HeartbeatInput,
  type HeartbeatOutput,
  type GetCoworkSessionInput,
  type GetCoworkSessionOutput,
  type GetCoworkSessionByInstanceInput,
  type GetCoworkSessionByInstanceOutput,
  type ListCoworkSessionsInput,
  type ListCoworkSessionsOutput,
  type ChatCoworkSessionInput,
  type ChatCoworkSessionOutput,
  type FinalizeCoworkSessionInput,
  type FinalizeCoworkSessionOutput,
  type CreateVoiceEphemeralKeyInput,
  type CreateVoiceEphemeralKeyOutput,
  type SynthesizeVoiceArtifactInput,
  type SynthesizeVoiceArtifactOutput,
  type ListPluginsOutput,
  ListAgentRunsInputSchema,
  ListAgentRunsOutputSchema,
  GetAgentRunInputSchema,
  GetAgentRunOutputSchema,
  type ListAgentRunsInput,
  type ListAgentRunsOutput,
  type GetAgentRunInput,
  type GetAgentRunOutput,
  MonitoringSummaryInputSchema,
  GetMonitoringSummaryOutputSchema,
  type MonitoringSummaryInput,
  type GetMonitoringSummaryOutput,
  GetConfigInputSchema,
  GetConfigOutputSchema,
  GetConfigByPrefixInputSchema,
  GetConfigByPrefixOutputSchema,
  SetConfigInputSchema,
  SetConfigOutputSchema,
  TestWebhookOutputSchema,
  type GetConfigOutput,
  type GetConfigByPrefixOutput,
  type SetConfigOutput,
  type TestWebhookOutput,
  GetEmailStatusOutputSchema,
  type GetEmailStatusOutput,
} from '../contract/index';
// SDK consumers reach for one path:
//   import { Mediforce, ApiError, type ApiErrorCode } from '@mediforce/platform-api/client';
// Server-side handlers throw `HandlerError` (or subclasses) imported from
// `@mediforce/platform-api/errors`; the wire envelope is the only shared
// surface, so the client just exposes `code`/`details` on `ApiError` directly.
import { ApiErrorEnvelopeSchema, type ApiErrorCode } from '../errors';
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
 * This class carries no browser auth of its own — same-origin browser calls
 * ride the NextAuth session cookie via the wrapper in
 * `packages/platform-ui/src/lib/mediforce.ts`.
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

/**
 * One downloaded Output File. `bytes` is the raw body (binary-safe);
 * `fileName` comes from the RFC 6266 `Content-Disposition` header with the
 * last path segment as fallback.
 */
export interface DownloadedRunOutputFile {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface DownloadedOutputFilesArchive {
  fileName: string;
  bytes: Uint8Array;
}

export class Mediforce {
  readonly tasks: {
    list: (input: ListTasksInput) => Promise<ListTasksOutput>;
    get: (input: GetTaskInput) => Promise<GetTaskOutput>;
    claim: (input: ClaimTaskInput) => Promise<ClaimTaskOutput>;
    complete: (input: CompleteTaskInput) => Promise<CompleteTaskOutput>;
    attachments: {
      list: (input: ListAttachmentsInput) => Promise<ListAttachmentsOutput>;
      upload: (input: {
        taskId: string;
        name: string;
        contentType: string;
        content: Uint8Array;
      }) => Promise<UploadAttachmentOutput>;
      delete: (input: DeleteAttachmentInput) => Promise<DeleteAttachmentOutput>;
    };
  };

  /**
   * Attachment blob helper. `blobUrl(id)` is the authenticated streaming URL
   * for an attachment's bytes — point an `<a download>` / `<img src>` at it;
   * the browser sends the session cookie. Server-to-server callers fetch it
   * via `request` with the configured auth header.
   */
  readonly attachments: {
    blobUrl: (attachmentId: string) => string;
  };

  readonly processes: {
    get: (input: GetProcessInput) => Promise<GetProcessOutput>;
    listAuditEvents: (input: ListAuditEventsInput) => Promise<ListAuditEventsOutput>;
    agentEvents: (input: ListAgentEventsInput) => Promise<ListAgentEventsOutput>;
    getSteps: (input: GetProcessStepsInput) => Promise<GetProcessStepsOutput>;
  };

  readonly cowork: {
    list: (input?: ListCoworkSessionsInput) => Promise<ListCoworkSessionsOutput>;
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
      input: RegisterWorkflowBody,
      options: RegisterWorkflowOptions,
    ) => Promise<RegisterWorkflowOutput>;
    validate: (input: ValidateWorkflowInput) => Promise<ValidateWorkflowOutput>;
    schema: () => Promise<GetWorkflowSchemaOutput>;
    list: (input?: ListWorkflowsRequest) => Promise<ListWorkflowsOutput>;
    get: (input: GetWorkflowInput) => Promise<GetWorkflowOutput>;
    versions: (input: ListWorkflowVersionsInput) => Promise<ListWorkflowVersionsOutput>;
    archiveVersion: (input: ArchiveVersionInput, options: { namespace: string }) => Promise<ArchiveVersionOutput>;
    archiveAll: (input: ArchiveAllInput, options: { namespace: string }) => Promise<ArchiveAllOutput>;
    setVisibility: (input: SetVisibilityInput, options: { namespace: string }) => Promise<SetVisibilityOutput>;
    copy: (input: CopyWorkflowInput, options: CopyWorkflowOptions & { sourceNamespace?: string }) => Promise<CopyWorkflowOutput>;
    setDefaultVersion: (input: SetDefaultVersionInput) => Promise<SetDefaultVersionOutput>;
    delete: (input: DeleteWorkflowInput) => Promise<DeleteWorkflowOutput>;
    getRunCount: (input: GetWorkflowRunCountInput) => Promise<GetWorkflowRunCountOutput>;
    transferNamespace: (input: TransferWorkflowInput) => Promise<TransferWorkflowOutput>;
    importFromRepo: (input: ImportWorkflowInput) => Promise<ImportWorkflowOutput>;
    getManifest: (input: GetManifestInput) => Promise<GetManifestOutput>;
  };

  readonly triggers: {
    list: (input: ListTriggersInput) => Promise<ListTriggersOutput>;
    create: (input: CreateTriggerInput) => Promise<CreateTriggerOutput>;
    update: (input: UpdateTriggerInput) => Promise<UpdateTriggerOutput>;
    setEnabled: (input: SetTriggerEnabledInput) => Promise<SetTriggerEnabledOutput>;
    delete: (input: DeleteTriggerInput) => Promise<DeleteTriggerOutput>;
  };

  readonly runs: {
    list: (input?: ListRunsInput) => Promise<ListRunsOutput>;
    listNames: (input: ListRunNamesInput) => Promise<ListRunNamesOutput>;
    get: (input: GetRunInput) => Promise<GetRunOutput>;
    listOutputFiles: (input: ListRunOutputFilesInput) => Promise<ListRunOutputFilesOutput>;
    downloadOutputFile: (input: DownloadRunOutputFileInput) => Promise<DownloadedRunOutputFile>;
    downloadOutputFilesArchive: (input: DownloadOutputFilesArchiveInput) => Promise<DownloadedOutputFilesArchive>;
    start: (input: StartRunInput) => Promise<StartRunOutput>;
    cancel: (input: CancelRunInput) => Promise<CancelRunOutput>;
    resume: (input: ResumeRunInput) => Promise<ResumeRunOutput>;
    retryStep: (input: RetryStepInput) => Promise<RetryStepOutput>;
    archive: (input: ArchiveRunInput) => Promise<ArchiveRunOutput>;
    bulkCancel: (input: BulkRunInput) => Promise<BulkRunOutput>;
    bulkArchive: (input: BulkRunInput) => Promise<BulkRunOutput>;
  };

  readonly agents: {
    list: (input?: ListAgentsInput) => Promise<ListAgentsOutput>;
    get: (input: GetAgentInput) => Promise<GetAgentOutput>;
    create: (input: CreateAgentBody) => Promise<CreateAgentOutput>;
    delete: (input: DeleteAgentInput) => Promise<DeleteAgentOutput>;
    update: (input: UpdateAgentInput, body: UpdateAgentBody) => Promise<UpdateAgentOutput>;
    listMcpBindings: (
      input: ListAgentMcpBindingsInput,
    ) => Promise<ListAgentMcpBindingsOutput>;
    upsertMcpBinding: (
      input: UpsertAgentMcpBindingInput,
    ) => Promise<UpsertAgentMcpBindingOutput>;
    deleteMcpBinding: (
      input: DeleteAgentMcpBindingInput,
    ) => Promise<DeleteAgentMcpBindingOutput>;
    listOAuthTokens: (
      input: ListAgentOAuthTokensInput,
    ) => Promise<ListAgentOAuthTokensOutput>;
    getOAuthToken: (
      input: GetAgentOAuthTokenInput,
    ) => Promise<GetAgentOAuthTokenOutput>;
    deleteOAuthToken: (
      input: DeleteAgentOAuthTokenInput,
    ) => Promise<DeleteAgentOAuthTokenOutput>;
  };

  readonly models: {
    list: (input?: ListModelsInput) => Promise<ListModelsOutput>;
    get: (input: GetModelInput) => Promise<GetModelOutput>;
    sync: () => Promise<SyncModelsOutput>;
    validate: (input: ValidateModelsInput) => Promise<ValidateModelsOutput>;
  };

  readonly secrets: {
    set: (input: SetSecretInput) => Promise<SetSecretOutput>;
    list: (input: ListSecretKeysInput) => Promise<ListSecretKeysOutput>;
    delete: (input: DeleteSecretInput) => Promise<DeleteSecretOutput>;
    workspacePreviews: (
      input: GetWorkspaceSecretPreviewsInput,
    ) => Promise<GetWorkspaceSecretPreviewsOutput>;
    workflowKeysBatch: (
      input: ListWorkflowSecretKeysBatchInput,
    ) => Promise<ListWorkflowSecretKeysBatchOutput>;
  };

  readonly workflowSecrets: {
    values: (input: GetWorkflowSecretsFullInput) => Promise<GetWorkflowSecretsFullOutput>;
    save: (input: SaveWorkflowSecretsInput) => Promise<SaveWorkflowSecretsOutput>;
  };

  readonly system: {
    dockerInfo: () => Promise<DockerInfoResponse>;
    credits: (input: OpenRouterCreditsInput) => Promise<OpenRouterCreditsOutput>;
    emailStatus: () => Promise<GetEmailStatusOutput>;
  };

  readonly cron: {
    heartbeat: (input?: HeartbeatInput) => Promise<HeartbeatOutput>;
  };

  readonly oauthProviders: {
    list: (input: ListOAuthProvidersInput) => Promise<ListOAuthProvidersOutput>;
    get: (input: GetOAuthProviderInput) => Promise<GetOAuthProviderOutput>;
    create: (input: CreateOAuthProviderInputApi) => Promise<CreateOAuthProviderOutput>;
    update: (input: UpdateOAuthProviderInputApi) => Promise<UpdateOAuthProviderOutput>;
    delete: (input: DeleteOAuthProviderInput) => Promise<DeleteOAuthProviderOutput>;
  };

  readonly dockerImages: {
    delete: (input: DeleteDockerImageInput) => Promise<DeleteDockerImageOutput>;
  };

  readonly toolCatalog: {
    list: (input: ListToolCatalogEntriesInput) => Promise<ListToolCatalogEntriesOutput>;
    get: (input: GetToolCatalogEntryInput) => Promise<GetToolCatalogEntryOutput>;
    create: (input: CreateToolCatalogEntryInputApi) => Promise<CreateToolCatalogEntryOutput>;
    update: (input: UpdateToolCatalogEntryInputApi) => Promise<UpdateToolCatalogEntryOutput>;
    delete: (input: DeleteToolCatalogEntryInput) => Promise<DeleteToolCatalogEntryOutput>;
  };

  readonly users: {
    listMembers: (input: ListNamespaceMembersInput) => Promise<ListNamespaceMembersOutput>;
    invite: (input: InviteUserInput) => Promise<InviteUserOutput>;
    resendInvite: (input: ResendInviteInput) => Promise<ResendInviteOutput>;
    me: (input?: GetMeInput) => Promise<GetMeOutput>;
    clearMustChangePassword: (input?: ClearMustChangePasswordInput) => Promise<ClearMustChangePasswordOutput>;
    setPassword: (input: SetPasswordInput) => Promise<SetPasswordOutput>;
  };

  readonly namespaces: {
    get: (input: GetNamespaceInput) => Promise<GetNamespaceOutput>;
    create: (input: CreateNamespaceInput) => Promise<CreateNamespaceOutput>;
    update: (input: UpdateNamespaceInput) => Promise<UpdateNamespaceOutput>;
    delete: (input: DeleteNamespaceInput) => Promise<DeleteNamespaceOutput>;
    leave: (input: LeaveNamespaceInput) => Promise<LeaveNamespaceOutput>;
    removeMember: (input: RemoveNamespaceMemberInput) => Promise<RemoveNamespaceMemberOutput>;
    updateMemberRole: (input: UpdateNamespaceMemberRoleInput) => Promise<UpdateNamespaceMemberRoleOutput>;
  };

  readonly agentRuns: {
    list: (input?: ListAgentRunsInput) => Promise<ListAgentRunsOutput>;
    get: (input: GetAgentRunInput) => Promise<GetAgentRunOutput>;
  };

  readonly monitoring: {
    summary: (input: MonitoringSummaryInput) => Promise<GetMonitoringSummaryOutput>;
  };

  readonly config: {
    get: (input: { key: string }) => Promise<GetConfigOutput>;
    getByPrefix: (input: { prefix: string }) => Promise<GetConfigByPrefixOutput>;
    set: (input: { key: string; value: string }) => Promise<SetConfigOutput>;
    testWebhook: () => Promise<TestWebhookOutput>;
  };

  constructor(private readonly clientConfig: ClientConfig) {
    // Defense-in-depth against JS callers / bad casts that bypass the
    // discriminated union (e.g. `new Mediforce()` with no argument, which the
    // type system already rejects). Treat a missing config like one with no
    // auth sources, triggering the same "exactly one" error below.
    const safeConfig = (clientConfig ?? {}) as Partial<{
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
      const baseUrl = (clientConfig as BaseClientConfig).baseUrl;
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
        return this.sendJson(
          'POST',
          `/api/tasks/${encodeURIComponent(validated.taskId)}/claim`,
          undefined,
          ClaimTaskOutputSchema,
          'mediforce.tasks.claim',
        );
      },
      complete: async (input) => {
        const validated = CompleteTaskInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/tasks/${encodeURIComponent(validated.taskId)}/complete`,
          validated.payload,
          CompleteTaskOutputSchema,
          'mediforce.tasks.complete',
        );
      },
      attachments: {
        list: async (input) => {
          const validated = ListAttachmentsInputSchema.parse(input);
          const res = await this.request(
            `/api/tasks/${encodeURIComponent(validated.taskId)}/attachments`,
          );
          const body = await parseJsonOrThrow(res, 'mediforce.tasks.attachments.list');
          return ListAttachmentsOutputSchema.parse(body);
        },
        upload: async (input) => {
          // multipart/form-data — let fetch set the boundary Content-Type.
          const form = new FormData();
          // `BlobPart` requires a Uint8Array backed by a plain ArrayBuffer; TS
          // widens the input's buffer to `ArrayBufferLike`. The bytes are always
          // a real ArrayBuffer here, so narrow it for the Blob constructor.
          const blobPart = input.content as unknown as BlobPart;
          form.append(
            'file',
            new Blob([blobPart], { type: input.contentType }),
            input.name,
          );
          const res = await this.request(
            `/api/tasks/${encodeURIComponent(input.taskId)}/attachments`,
            { method: 'POST', body: form },
          );
          const body = await parseJsonOrThrow(res, 'mediforce.tasks.attachments.upload');
          return UploadAttachmentOutputSchema.parse(body);
        },
        delete: async (input) => {
          const validated = DeleteAttachmentInputSchema.parse(input);
          const res = await this.request(
            `/api/attachments/${encodeURIComponent(validated.attachmentId)}`,
            { method: 'DELETE' },
          );
          const body = await parseJsonOrThrow(res, 'mediforce.tasks.attachments.delete');
          return DeleteAttachmentOutputSchema.parse(body);
        },
      },
    };

    this.attachments = {
      blobUrl: (attachmentId) => {
        const base = this.clientConfig.baseUrl ?? '';
        return `${base}/api/attachments/${encodeURIComponent(attachmentId)}/blob`;
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
      agentEvents: async (input) => {
        const validated = ListAgentEventsInputSchema.parse(input);
        const qs = toSearchParams({
          stepId: validated.stepId,
          afterSequence:
            validated.afterSequence === undefined
              ? undefined
              : String(validated.afterSequence),
        });
        const res = await this.request(
          `/api/processes/${encodeURIComponent(validated.instanceId)}/agent-events${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.processes.agentEvents');
        return ListAgentEventsOutputSchema.parse(body);
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
      list: async (input) => {
        const validated = ListCoworkSessionsInputSchema.parse(input ?? {});
        const qs = toSearchParams({
          role: validated.role,
          status: validated.status,
        });
        const res = await this.request(`/api/cowork${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.cowork.list');
        return ListCoworkSessionsOutputSchema.parse(body);
      },
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
      chat: (input) => {
        const v = ChatCoworkSessionInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/cowork/${encodeURIComponent(v.sessionId)}/chat`,
          { message: v.message },
          ChatCoworkSessionOutputSchema,
          'mediforce.cowork.chat',
        );
      },
      finalize: (input) => {
        const v = FinalizeCoworkSessionInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/cowork/${encodeURIComponent(v.sessionId)}/finalize`,
          { artifact: v.artifact },
          FinalizeCoworkSessionOutputSchema,
          'mediforce.cowork.finalize',
        );
      },
      voiceEphemeralKey: (input) => {
        const v = CreateVoiceEphemeralKeyInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/cowork/${encodeURIComponent(v.sessionId)}/voice/ephemeral-key`,
          undefined,
          CreateVoiceEphemeralKeyOutputSchema,
          'mediforce.cowork.voiceEphemeralKey',
        );
      },
      voiceSynthesize: (input) => {
        const v = SynthesizeVoiceArtifactInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/cowork/${encodeURIComponent(v.sessionId)}/voice/synthesize`,
          { transcript: v.transcript, comment: v.comment },
          SynthesizeVoiceArtifactOutputSchema,
          'mediforce.cowork.voiceSynthesize',
        );
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
        return this.sendJson(
          'POST',
          `/api/workflow-definitions${qs}`,
          { ...validatedInput },
          RegisterWorkflowOutputSchema,
          'mediforce.workflows.register',
        );
      },
      validate: async (input) => {
        return this.sendJson(
          'POST',
          '/api/workflow-definitions/validate',
          { ...input },
          ValidateWorkflowOutputSchema,
          'mediforce.workflows.validate',
        );
      },
      schema: async () => {
        const res = await this.request('/api/workflow-definitions/schema');
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.schema');
        return GetWorkflowSchemaOutputSchema.parse(body);
      },
      list: async (input) => {
        const validated = input ? ListWorkflowsInputSchema.parse(input) : undefined;
        const qs = validated
          ? toSearchParams({
              namespace: validated.namespace,
              // Forward only when the caller turns "show completed" off; the
              // server defaults to true, so omitting keeps the common URL clean.
              includeCompletedRuns: validated.includeCompletedRuns ? undefined : 'false',
            })
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
      versions: async (input) => {
        const validated = ListWorkflowVersionsInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/versions${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.versions');
        return ListWorkflowVersionsOutputSchema.parse(body);
      },
      archiveVersion: (input, options) => {
        const validated = ArchiveVersionInputSchema.parse(input);
        const qs = toSearchParams({ namespace: options.namespace });
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/versions/${validated.version}/archive${qs}`,
          { archived: validated.archived },
          ArchiveVersionOutputSchema,
          'mediforce.workflows.archiveVersion',
        );
      },
      archiveAll: (input, options) => {
        const validated = ArchiveAllInputSchema.parse(input);
        const qs = toSearchParams({ namespace: options.namespace });
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/archive${qs}`,
          { archived: validated.archived },
          ArchiveAllOutputSchema,
          'mediforce.workflows.archiveAll',
        );
      },
      setVisibility: (input, options) => {
        const validated = SetVisibilityInputSchema.parse(input);
        const qs = toSearchParams({ namespace: options.namespace });
        return this.sendJson(
          'PATCH',
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}${qs}`,
          { visibility: validated.visibility },
          SetVisibilityOutputSchema,
          'mediforce.workflows.setVisibility',
        );
      },
      setDefaultVersion: (input) => {
        const v = SetDefaultVersionInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(v.name)}/default-version`,
          { namespace: v.namespace, version: v.version },
          SetDefaultVersionOutputSchema,
          'mediforce.workflows.setDefaultVersion',
        );
      },
      delete: (input) => {
        const v = DeleteWorkflowInputSchema.parse(input);
        const qs = toSearchParams({ namespace: v.namespace });
        return this.sendJson(
          'DELETE',
          `/api/workflow-definitions/${encodeURIComponent(v.name)}${qs}`,
          { expectedRunCount: v.expectedRunCount, namespace: v.namespace },
          DeleteWorkflowOutputSchema,
          'mediforce.workflows.delete',
        );
      },
      getRunCount: async (input) => {
        const v = GetWorkflowRunCountInputSchema.parse(input);
        const qs = toSearchParams({ namespace: v.namespace });
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(v.name)}/run-count${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.getRunCount');
        return GetWorkflowRunCountOutputSchema.parse(body);
      },
      transferNamespace: (input) => {
        const v = TransferWorkflowInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(v.name)}/transfer`,
          { sourceNamespace: v.sourceNamespace, targetNamespace: v.targetNamespace },
          TransferWorkflowOutputSchema,
          'mediforce.workflows.transferNamespace',
        );
      },
      copy: (input, options) => {
        const validated = CopyWorkflowInputSchema.parse(input);
        const qs = toSearchParams({
          targetNamespace: options.targetNamespace,
          ...(options.sourceNamespace !== undefined ? { namespace: options.sourceNamespace } : {}),
        });
        const reqBody: Record<string, unknown> = {};
        if (validated.version !== undefined) reqBody.version = validated.version;
        if (validated.targetName !== undefined) reqBody.targetName = validated.targetName;
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(validated.name)}/copy${qs}`,
          reqBody,
          CopyWorkflowOutputSchema,
          'mediforce.workflows.copy',
        );
      },
      importFromRepo: async (input) => {
        const validated = ImportWorkflowInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/import${qs}`,
          { repo: validated.repo, path: validated.path, ref: validated.ref },
          RegisterWorkflowOutputSchema,
          'mediforce.workflows.importFromRepo',
        );
      },
      getManifest: async (input) => {
        const validated = GetManifestInputSchema.parse(input);
        const qs = toSearchParams({ repo: validated.repo, ref: validated.ref });
        const res = await this.request(`/api/workflow-definitions/manifest${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.workflows.getManifest');
        return GetManifestOutputSchema.parse(body);
      },
    };

    this.triggers = {
      list: async (input) => {
        const v = ListTriggersInputSchema.parse(input);
        const qs = toSearchParams({ namespace: v.namespace });
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(v.definitionName)}/triggers${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.triggers.list');
        return ListTriggersOutputSchema.parse(body);
      },
      create: (input) => {
        const v = CreateTriggerInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(v.definitionName)}/triggers`,
          {
            namespace: v.namespace,
            triggerName: v.triggerName,
            type: v.type,
            schedule: v.schedule,
            method: v.method,
            path: v.path,
            enabled: v.enabled,
          },
          CreateTriggerOutputSchema,
          'mediforce.triggers.create',
        );
      },
      update: (input) => {
        const v = UpdateTriggerInputSchema.parse(input);
        return this.sendJson(
          'PATCH',
          `/api/workflow-definitions/${encodeURIComponent(v.definitionName)}/triggers/${encodeURIComponent(v.triggerName)}`,
          { namespace: v.namespace, schedule: v.schedule },
          UpdateTriggerOutputSchema,
          'mediforce.triggers.update',
        );
      },
      setEnabled: (input) => {
        const v = SetTriggerEnabledInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/workflow-definitions/${encodeURIComponent(v.definitionName)}/triggers/${encodeURIComponent(v.triggerName)}/enabled`,
          { namespace: v.namespace, enabled: v.enabled },
          SetTriggerEnabledOutputSchema,
          'mediforce.triggers.setEnabled',
        );
      },
      delete: async (input) => {
        const v = DeleteTriggerInputSchema.parse(input);
        const qs = toSearchParams({ namespace: v.namespace });
        const res = await this.request(
          `/api/workflow-definitions/${encodeURIComponent(v.definitionName)}/triggers/${encodeURIComponent(v.triggerName)}${qs}`,
          { method: 'DELETE' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.triggers.delete');
        return DeleteTriggerOutputSchema.parse(body);
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
        return this.sendJson(
          'DELETE',
          `/api/agents/${encodeURIComponent(validated.id)}`,
          undefined,
          DeleteAgentOutputSchema,
          'mediforce.agents.delete',
        );
      },
      update: (input, updateBody) => {
        const validatedInput = UpdateAgentInputSchema.parse(input);
        const validatedBody = UpdateAgentBodySchema.parse(updateBody);
        return this.sendJson(
          'PUT',
          `/api/agents/${encodeURIComponent(validatedInput.id)}`,
          validatedBody,
          UpdateAgentOutputSchema,
          'mediforce.agents.update',
        );
      },
      create: (input) => {
        const v = CreateAgentInputSchema.parse(input);
        return this.sendJson(
          'POST',
          '/api/agents',
          { ...v },
          CreateAgentOutputSchema,
          'mediforce.agents.create',
        );
      },
      listMcpBindings: async (input) => {
        const v = ListAgentMcpBindingsInputSchema.parse(input);
        const res = await this.request(`/api/agents/${encodeURIComponent(v.id)}/mcp-servers`);
        const body = await parseJsonOrThrow(res, 'mediforce.agents.listMcpBindings');
        return ListAgentMcpBindingsOutputSchema.parse(body);
      },
      upsertMcpBinding: (input) => {
        const v = UpsertAgentMcpBindingInputSchema.parse(input);
        return this.sendJson(
          'PUT',
          `/api/agents/${encodeURIComponent(v.id)}/mcp-servers/${encodeURIComponent(v.name)}`,
          v.binding,
          UpsertAgentMcpBindingOutputSchema,
          'mediforce.agents.upsertMcpBinding',
        );
      },
      deleteMcpBinding: (input) => {
        const v = DeleteAgentMcpBindingInputSchema.parse(input);
        return this.sendJson(
          'DELETE',
          `/api/agents/${encodeURIComponent(v.id)}/mcp-servers/${encodeURIComponent(v.name)}`,
          undefined,
          DeleteAgentMcpBindingOutputSchema,
          'mediforce.agents.deleteMcpBinding',
        );
      },
      listOAuthTokens: async (input) => {
        const v = ListAgentOAuthTokensInputSchema.parse(input);
        const qs = toSearchParams({ namespace: v.namespace });
        const res = await this.request(
          `/api/agents/${encodeURIComponent(v.id)}/oauth${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agents.listOAuthTokens');
        return ListAgentOAuthTokensOutputSchema.parse(body);
      },
      getOAuthToken: async (input) => {
        const v = GetAgentOAuthTokenInputSchema.parse(input);
        const qs = toSearchParams({ namespace: v.namespace, serverName: v.serverName });
        const res = await this.request(
          `/api/agents/${encodeURIComponent(v.id)}/oauth/${encodeURIComponent(v.provider)}${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agents.getOAuthToken');
        return GetAgentOAuthTokenOutputSchema.parse(body);
      },
      deleteOAuthToken: async (input) => {
        const v = DeleteAgentOAuthTokenInputSchema.parse(input);
        const qs = toSearchParams({
          namespace: v.namespace,
          serverName: v.serverName,
          ...(v.revokeAtProvider !== undefined
            ? { revokeAtProvider: v.revokeAtProvider ? 'true' : 'false' }
            : {}),
        });
        const res = await this.request(
          `/api/agents/${encodeURIComponent(v.id)}/oauth/${encodeURIComponent(v.provider)}${qs}`,
          { method: 'DELETE' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agents.deleteOAuthToken');
        return DeleteAgentOAuthTokenOutputSchema.parse(body);
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
      validate: async (input) => {
        const validated = ValidateModelsInputSchema.parse(input);
        const res = await this.request('/api/model-registry/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validated),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.models.validate');
        return ValidateModelsOutputSchema.parse(body);
      },
    };

    this.runs = {
      list: async (input) => {
        const validated = ListRunsInputSchema.parse(input ?? {});
        const qs = toSearchParams({
          workflow: validated.workflow,
          status: validated.status,
          namespace: validated.namespace,
          limit: validated.limit !== undefined ? String(validated.limit) : undefined,
        });
        const res = await this.request(`/api/runs${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.runs.list');
        return ListRunsOutputSchema.parse(body);
      },
      listNames: async (input) => {
        const validated = ListRunNamesInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/runs/names${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.runs.listNames');
        return ListRunNamesOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetRunInputSchema.parse(input);
        const res = await this.request(
          `/api/runs/${encodeURIComponent(validated.runId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.runs.get');
        return GetRunOutputSchema.parse(body);
      },
      listOutputFiles: async (input) => {
        const validated = ListRunOutputFilesInputSchema.parse(input);
        const res = await this.request(
          `/api/runs/${encodeURIComponent(validated.runId)}/files`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.runs.listOutputFiles');
        return ListRunOutputFilesOutputSchema.parse(body);
      },
      downloadOutputFile: async (input) => {
        const validated = DownloadRunOutputFileInputSchema.parse(input);
        // `path` is repo-relative with meaningful slashes (`.mediforce/output/<stepId>/<name>`)
        // — encode each segment, keep the separators.
        const encodedPath = validated.path
          .split('/')
          .map(encodeURIComponent)
          .join('/');
        const res = await this.request(
          `/api/runs/${encodeURIComponent(validated.runId)}/files/${encodedPath}`,
        );
        if (res.ok === false) {
          // Error responses are the JSON envelope — parseJsonOrThrow always
          // throws ApiError on non-OK.
          await parseJsonOrThrow(res, 'mediforce.runs.downloadOutputFile');
        }
        const fileName =
          fileNameFromContentDisposition(res.headers.get('Content-Disposition')) ??
          validated.path.split('/').pop() ??
          'download';
        return {
          fileName,
          contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
          bytes: new Uint8Array(await res.arrayBuffer()),
        };
      },
      downloadOutputFilesArchive: async (input) => {
        const validated = DownloadOutputFilesArchiveInputSchema.parse(input);
        const res = await this.request(
          `/api/runs/${encodeURIComponent(validated.runId)}/files/archive`,
        );
        if (res.ok === false) {
          await parseJsonOrThrow(res, 'mediforce.runs.downloadOutputFilesArchive');
        }
        const fileName =
          fileNameFromContentDisposition(res.headers.get('Content-Disposition')) ??
          'output.zip';
        return {
          fileName,
          bytes: new Uint8Array(await res.arrayBuffer()),
        };
      },
      start: async (input) => {
        const validated = StartRunInputSchema.parse(input);
        return this.sendJson(
          'POST',
          '/api/processes',
          validated,
          StartRunOutputSchema,
          'mediforce.runs.start',
        );
      },
      cancel: async (input) => {
        const validated = CancelRunInputSchema.parse(input);
        const body = validated.reason !== undefined ? { reason: validated.reason } : {};
        return this.sendJson(
          'POST',
          `/api/processes/${encodeURIComponent(validated.runId)}/cancel`,
          body,
          CancelRunOutputSchema,
          'mediforce.runs.cancel',
        );
      },
      resume: async (input) => {
        const validated = ResumeRunInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/processes/${encodeURIComponent(validated.runId)}/resume`,
          undefined,
          ResumeRunOutputSchema,
          'mediforce.runs.resume',
        );
      },
      retryStep: async (input) => {
        const validated = RetryStepInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/processes/${encodeURIComponent(validated.runId)}/steps/${encodeURIComponent(validated.stepId)}/retry`,
          undefined,
          RetryStepOutputSchema,
          'mediforce.runs.retryStep',
        );
      },
      archive: (input) => {
        const v = ArchiveRunInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/processes/${encodeURIComponent(v.runId)}/archive`,
          { archived: v.archived },
          ArchiveRunOutputSchema,
          'mediforce.runs.archive',
        );
      },
      bulkCancel: (input) => {
        const v = BulkRunInputSchema.parse(input);
        return this.sendJson(
          'POST',
          '/api/processes/bulk/cancel',
          { runIds: v.runIds },
          BulkRunOutputSchema,
          'mediforce.runs.bulkCancel',
        );
      },
      bulkArchive: (input) => {
        const v = BulkRunInputSchema.parse(input);
        return this.sendJson(
          'POST',
          '/api/processes/bulk/archive',
          { runIds: v.runIds },
          BulkRunOutputSchema,
          'mediforce.runs.bulkArchive',
        );
      },
    };

    this.secrets = {
      set: async (input) => {
        const validated = SetSecretInputSchema.parse(input);
        const params: Record<string, string> = { namespace: validated.namespace };
        if (validated.workflow) params.workflow = validated.workflow;
        const qs = toSearchParams(params);
        return this.sendJson(
          'PUT',
          `/api/workflow-secrets${qs}`,
          { key: validated.key, value: validated.value },
          SetSecretOutputSchema,
          'mediforce.secrets.set',
        );
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
        return this.sendJson(
          'DELETE',
          `/api/workflow-secrets${qs}`,
          undefined,
          DeleteSecretOutputSchema,
          'mediforce.secrets.delete',
        );
      },
      workspacePreviews: async (input) => {
        const validated = GetWorkspaceSecretPreviewsInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/workspace-secrets/previews${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.secrets.workspacePreviews');
        return GetWorkspaceSecretPreviewsOutputSchema.parse(body);
      },
      workflowKeysBatch: async (input) => {
        const validated = ListWorkflowSecretKeysBatchInputSchema.parse(input);
        const qs = toSearchParams({
          namespace: validated.namespace,
          workflow: validated.workflows,
        });
        const res = await this.request(`/api/workflow-secrets/keys-batch${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.secrets.workflowKeysBatch');
        return ListWorkflowSecretKeysBatchOutputSchema.parse(body);
      },
    };

    this.workflowSecrets = {
      values: async (input) => {
        const validated = GetWorkflowSecretsFullInputSchema.parse(input);
        const qs = toSearchParams({
          namespace: validated.namespace,
          workflow: validated.workflow,
        });
        const res = await this.request(`/api/workflow-secrets/values${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.workflowSecrets.values');
        return GetWorkflowSecretsFullOutputSchema.parse(body);
      },
      save: (input) => {
        const validated = SaveWorkflowSecretsInputSchema.parse(input);
        const qs = toSearchParams({
          namespace: validated.namespace,
          workflow: validated.workflow,
        });
        return this.sendJson(
          'PUT',
          `/api/workflow-secrets/values${qs}`,
          { secrets: validated.secrets },
          SaveWorkflowSecretsOutputSchema,
          'mediforce.workflowSecrets.save',
        );
      },
    };

    this.system = {
      dockerInfo: async () => {
        const res = await this.request('/api/system/docker-info');
        const body = await parseJsonOrThrow(res, 'mediforce.system.dockerInfo');
        return DockerInfoResponseSchema.parse(body);
      },
      credits: async (input: OpenRouterCreditsInput) => {
        const validated = OpenRouterCreditsInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/system/openrouter-credits${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.system.credits');
        return OpenRouterCreditsOutputSchema.parse(body);
      },
      emailStatus: async () => {
        const res = await this.request('/api/admin/email-status');
        const body = await parseJsonOrThrow(res, 'mediforce.system.emailStatus');
        return GetEmailStatusOutputSchema.parse(body);
      },
    };

    this.cron = {
      heartbeat: async (input) => {
        HeartbeatInputSchema.parse(input ?? {});
        return this.sendJson(
          'POST',
          '/api/cron/heartbeat',
          undefined,
          HeartbeatOutputSchema,
          'mediforce.cron.heartbeat',
        );
      },
    };

    this.oauthProviders = {
      list: async (input) => {
        const validated = ListOAuthProvidersInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/admin/oauth-providers${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.oauthProviders.list');
        return ListOAuthProvidersOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetOAuthProviderInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(
          `/api/admin/oauth-providers/${encodeURIComponent(validated.id)}${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.oauthProviders.get');
        return GetOAuthProviderOutputSchema.parse(body);
      },
      create: async (input) => {
        const validated = CreateOAuthProviderInputApiSchema.parse(input);
        const { namespace, ...createBody } = validated;
        const qs = toSearchParams({ namespace });
        const res = await this.request(`/api/admin/oauth-providers${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.oauthProviders.create');
        return CreateOAuthProviderOutputSchema.parse(body);
      },
      update: async (input) => {
        const validated = UpdateOAuthProviderInputApiSchema.parse(input);
        const { namespace, id, ...patch } = validated;
        const qs = toSearchParams({ namespace });
        const res = await this.request(
          `/api/admin/oauth-providers/${encodeURIComponent(id)}${qs}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.oauthProviders.update');
        return UpdateOAuthProviderOutputSchema.parse(body);
      },
      delete: async (input) => {
        const validated = DeleteOAuthProviderInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(
          `/api/admin/oauth-providers/${encodeURIComponent(validated.id)}${qs}`,
          { method: 'DELETE' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.oauthProviders.delete');
        return DeleteOAuthProviderOutputSchema.parse(body);
      },
    };

    this.dockerImages = {
      delete: async (input) => {
        const validated = DeleteDockerImageInputSchema.parse(input);
        const res = await this.request('/api/admin/docker-images', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: validated.imageId }),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.dockerImages.delete');
        return DeleteDockerImageOutputSchema.parse(body);
      },
    };

    this.toolCatalog = {
      list: async (input) => {
        const validated = ListToolCatalogEntriesInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/admin/tool-catalog${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.toolCatalog.list');
        return ListToolCatalogEntriesOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetToolCatalogEntryInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(
          `/api/admin/tool-catalog/${encodeURIComponent(validated.id)}${qs}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.toolCatalog.get');
        return GetToolCatalogEntryOutputSchema.parse(body);
      },
      create: async (input) => {
        const validated = CreateToolCatalogEntryInputApiSchema.parse(input);
        const { namespace, ...createBody } = validated;
        const qs = toSearchParams({ namespace });
        const res = await this.request(`/api/admin/tool-catalog${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.toolCatalog.create');
        return CreateToolCatalogEntryOutputSchema.parse(body);
      },
      update: async (input) => {
        const validated = UpdateToolCatalogEntryInputApiSchema.parse(input);
        const { namespace, id, ...patch } = validated;
        const qs = toSearchParams({ namespace });
        const res = await this.request(
          `/api/admin/tool-catalog/${encodeURIComponent(id)}${qs}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.toolCatalog.update');
        return UpdateToolCatalogEntryOutputSchema.parse(body);
      },
      delete: async (input) => {
        const validated = DeleteToolCatalogEntryInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(
          `/api/admin/tool-catalog/${encodeURIComponent(validated.id)}${qs}`,
          { method: 'DELETE' },
        );
        const body = await parseJsonOrThrow(res, 'mediforce.toolCatalog.delete');
        return DeleteToolCatalogEntryOutputSchema.parse(body);
      },
    };

    this.agentRuns = {
      list: async (input) => {
        const validated = ListAgentRunsInputSchema.parse(input ?? {});
        const qs = toSearchParams({
          namespace: validated.namespace,
          runId: validated.runId,
          stepId: validated.stepId,
          limit: validated.limit !== undefined ? String(validated.limit) : undefined,
          cursor: validated.cursor,
        });
        const res = await this.request(`/api/agent-runs${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.agentRuns.list');
        return ListAgentRunsOutputSchema.parse(body);
      },
      get: async (input) => {
        const validated = GetAgentRunInputSchema.parse(input);
        const res = await this.request(
          `/api/agent-runs/${encodeURIComponent(validated.agentRunId)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.agentRuns.get');
        return GetAgentRunOutputSchema.parse(body);
      },
    };

    this.monitoring = {
      summary: async (input) => {
        const validated = MonitoringSummaryInputSchema.parse(input);
        const res = await this.request(
          `/api/namespaces/${encodeURIComponent(validated.handle)}/monitoring/summary`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.monitoring.summary');
        return GetMonitoringSummaryOutputSchema.parse(body);
      },
    };

    this.users = {
      listMembers: async (input) => {
        const validated = ListNamespaceMembersInputSchema.parse(input);
        const qs = toSearchParams({ namespace: validated.namespace });
        const res = await this.request(`/api/users/members${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.users.listMembers');
        return ListNamespaceMembersOutputSchema.parse(body);
      },
      invite: async (input) => {
        const validated = InviteUserInputSchema.parse(input);
        const res = await this.request('/api/users/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validated),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.users.invite');
        return InviteUserOutputSchema.parse(body);
      },
      resendInvite: async (input) => {
        const validated = ResendInviteInputSchema.parse(input);
        const res = await this.request('/api/users/resend-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validated),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.users.resendInvite');
        return ResendInviteOutputSchema.parse(body);
      },
      me: async (input) => {
        const qs = input?.uid !== undefined && input.uid !== ''
          ? toSearchParams({ uid: input.uid })
          : '';
        const res = await this.request(`/api/users/me${qs}`);
        const body = await parseJsonOrThrow(res, 'mediforce.users.me');
        return GetMeOutputSchema.parse(body);
      },
      clearMustChangePassword: async (input) => {
        const validated = ClearMustChangePasswordInputSchema.parse(input ?? {});
        return this.sendJson(
          'POST',
          '/api/users/me/clear-must-change-password',
          validated,
          ClearMustChangePasswordOutputSchema,
          'mediforce.users.clearMustChangePassword',
        );
      },
      setPassword: async (input) => {
        const validated = SetPasswordInputSchema.parse(input);
        return this.sendJson(
          'POST',
          '/api/users/set-password',
          validated,
          SetPasswordOutputSchema,
          'mediforce.users.setPassword',
        );
      },
    };

    this.namespaces = {
      get: async (input) => {
        const validated = GetNamespaceInputSchema.parse(input);
        const res = await this.request(
          `/api/namespaces/${encodeURIComponent(validated.handle)}`,
        );
        const body = await parseJsonOrThrow(res, 'mediforce.namespaces.get');
        return GetNamespaceOutputSchema.parse(body);
      },
      create: async (input) => {
        const validated = CreateNamespaceInputSchema.parse(input);
        const res = await this.request('/api/namespaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validated),
        });
        const body = await parseJsonOrThrow(res, 'mediforce.namespaces.create');
        return CreateNamespaceOutputSchema.parse(body);
      },
      update: async (input) => {
        const validated = UpdateNamespaceInputSchema.parse(input);
        const body = UpdateNamespaceBodySchema.parse(input);
        return this.sendJson(
          'PATCH',
          `/api/namespaces/${encodeURIComponent(validated.handle)}`,
          body,
          UpdateNamespaceOutputSchema,
          'mediforce.namespaces.update',
        );
      },
      delete: async (input) => {
        const validated = DeleteNamespaceInputSchema.parse(input);
        return this.sendJson(
          'DELETE',
          `/api/namespaces/${encodeURIComponent(validated.handle)}`,
          undefined,
          DeleteNamespaceOutputSchema,
          'mediforce.namespaces.delete',
        );
      },
      leave: async (input) => {
        const validated = LeaveNamespaceInputSchema.parse(input);
        return this.sendJson(
          'POST',
          `/api/namespaces/${encodeURIComponent(validated.handle)}/leave`,
          undefined,
          LeaveNamespaceOutputSchema,
          'mediforce.namespaces.leave',
        );
      },
      removeMember: async (input) => {
        const validated = RemoveNamespaceMemberInputSchema.parse(input);
        return this.sendJson(
          'DELETE',
          `/api/namespaces/${encodeURIComponent(validated.handle)}/members/${encodeURIComponent(validated.uid)}`,
          undefined,
          RemoveNamespaceMemberOutputSchema,
          'mediforce.namespaces.removeMember',
        );
      },
      updateMemberRole: async (input) => {
        const validated = UpdateNamespaceMemberRoleInputSchema.parse(input);
        const body = UpdateNamespaceMemberRoleBodySchema.parse(input);
        return this.sendJson(
          'PATCH',
          `/api/namespaces/${encodeURIComponent(validated.handle)}/members/${encodeURIComponent(validated.uid)}`,
          body,
          UpdateNamespaceMemberRoleOutputSchema,
          'mediforce.namespaces.updateMemberRole',
        );
      },
    };

    this.config = {
      get: async (input) => {
        const validated = GetConfigInputSchema.parse(input);
        const qs = `?key=${encodeURIComponent(validated.key)}`;
        const res = await this.request(`/api/config${qs}`);
        const responseBody = await parseJsonOrThrow(res, 'mediforce.config.get');
        return GetConfigOutputSchema.parse(responseBody);
      },
      getByPrefix: async (input) => {
        const validated = GetConfigByPrefixInputSchema.parse(input);
        const qs = `?prefix=${encodeURIComponent(validated.prefix)}`;
        const res = await this.request(`/api/config${qs}`);
        const responseBody = await parseJsonOrThrow(res, 'mediforce.config.getByPrefix');
        return GetConfigByPrefixOutputSchema.parse(responseBody);
      },
      set: async (input) => {
        const validated = SetConfigInputSchema.parse(input);
        return this.sendJson(
          'PUT',
          '/api/config',
          { key: validated.key, value: validated.value },
          SetConfigOutputSchema,
          'mediforce.config.set',
        );
      },
      testWebhook: async () => {
        return this.sendJson(
          'POST',
          '/api/config/test-webhook',
          undefined,
          TestWebhookOutputSchema,
          'mediforce.config.testWebhook',
        );
      },
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const authHeaders = await this.buildAuthHeaders();
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(authHeaders)) {
      if (!headers.has(key)) headers.set(key, value);
    }
    const base = this.clientConfig.baseUrl ?? '';
    const fetchImpl = this.clientConfig.fetch ?? globalThis.fetch;
    return fetchImpl(`${base}${path}`, { ...init, headers });
  }

  /**
   * Mutation helper — `request(method, body)` → `parseJsonOrThrow` →
   * `outputSchema.parse(body)`. Callsites pre-validate input via
   * `<InputSchema>.parse` so `path` / `body` are typed; this helper covers
   * everything past that, giving the mutation methods a single shared seam.
   *
   * `body` is `undefined` for verb-only mutations (POST with no payload —
   * e.g. `cowork.voiceEphemeralKey`, `tasks.claim`). When set, the helper
   * attaches `Content-Type: application/json` and serializes.
   */
  private async sendJson<TOut>(
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    outputSchema: { parse: (b: unknown) => TOut },
    ctx: string,
  ): Promise<TOut> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await this.request(path, init);
    return outputSchema.parse(await parseJsonOrThrow(res, ctx));
  }

  private async buildAuthHeaders(): Promise<Record<string, string>> {
    if (this.clientConfig.apiKey !== undefined) {
      return { 'X-Api-Key': this.clientConfig.apiKey };
    }
    if (this.clientConfig.bearerToken !== undefined) {
      const token = await this.clientConfig.bearerToken();
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

/**
 * Extract the file name from an RFC 6266 `Content-Disposition` header.
 * Prefers the percent-encoded `filename*` parameter (full Unicode), falls
 * back to the quoted `filename`, returns null when neither parses.
 */
function fileNameFromContentDisposition(header: string | null): string | null {
  if (header === null) return null;
  const extendedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (extendedMatch !== null) {
    try {
      return decodeURIComponent(extendedMatch[1]);
    } catch {
      return null;
    }
  }
  const quotedMatch = header.match(/filename="((?:[^"\\]|\\.)*)"/);
  if (quotedMatch !== null) {
    return quotedMatch[1].replace(/\\(.)/g, '$1');
  }
  return null;
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
