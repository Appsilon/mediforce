// Interfaces
export type {
  AutonomyLevel,
  LlmMessage,
  LlmResponse,
  LlmClient,
  AgentContext,
  WorkflowAgentContext,
  ResolvedOAuthBinding,
  EmitPayload,
  EmitFn,
  AgentPlugin,
  ReviewPlugin,
  ReviewPluginContext,
  ReviewPluginResult,
  ReviewVerdict,
} from './interfaces/index';

// Plugins
export { BaseContainerAgentPlugin, isLocalExecutionAllowed, OAuthTokenUnavailableError, validateOutputSchema } from './plugins/base-container-agent-plugin';
export type { AgentCommandSpec, OutputSchema, SpawnCliOptions, SpawnDockerResult } from './plugins/base-container-agent-plugin';
export { ClaudeCodeAgentPlugin } from './plugins/claude-code-agent-plugin';
export { MockClaudeCodeAgentPlugin } from './plugins/mock-claude-code-agent-plugin';
export { OpenCodeAgentPlugin } from './plugins/opencode-agent-plugin';
export { ScriptContainerPlugin } from './plugins/script-container-plugin';
export { DatabricksJobPlugin } from './plugins/databricks/databricks-job-plugin';
export type { DatabricksJobPluginInit } from './plugins/databricks/databricks-job-plugin';
export { DatabricksClient } from './plugins/databricks/databricks-client';
export type { DatabricksClientInit, DatabricksRunStatus } from './plugins/databricks/databricks-client';
export type { DockerSpawnStrategy, DockerSpawnRequest, DockerSpawnResult } from './plugins/docker-spawn-strategy';

// Runner
export type { AgentEventLog } from './runner/agent-event-log';
export { PluginRegistry, PluginNotFoundError } from './runner/plugin-registry';
export { OpenRouterLlmClient } from './runner/llm-client';
export { PluginRunner } from './runner/plugin-runner';
export type { PluginRunResult } from './runner/plugin-runner';
export { AgentRunner } from './runner/agent-runner';
export type { AgentRunResult } from './runner/agent-runner';
export { FallbackHandler } from './runner/fallback-handler';

// Env validation
export { validateWorkflowEnv, validateWorkflowModels, validateRetiredModels } from './plugins/resolve-env';
export type { MissingEnvVar, UnknownModel, RetiredModelRef } from './plugins/resolve-env';

// MCP resolution helpers
export { resolveMcpForStep, AgentDefinitionNotFoundError } from './mcp/resolve-mcp-for-step';
export type { ResolveMcpForStepDeps } from './mcp/resolve-mcp-for-step';
export { flattenResolvedMcpToLegacy } from './mcp/flatten-resolved-mcp';

// OAuth (Step 5)
export {
  signState,
  verifyState,
  generateNonce,
  generatePkcePair,
  type OAuthStatePayload,
  type PkcePair,
} from './oauth/state-hmac';
export {
  REFRESH_MARGIN_MS,
  RefreshTokenRejectedError,
  RefreshTokenUnavailableError,
  renderOAuthHeader,
  resolveOAuthToken,
  type ResolvedToken,
  type ResolveTokenOptions,
} from './oauth/resolve-oauth-token';
export {
  discoverMcpAuthServer,
  deriveProviderSlug,
  extractResourceMetadataUrl,
  McpDiscoveryError,
  type DiscoveredAuthServer,
  type ProtectedResourceMetadata,
  type AuthServerMetadata,
} from './oauth/mcp-oauth-discovery';
export {
  registerOAuthClient,
  pickAuthMethod,
  DcrError,
  type DcrRequest,
  type DcrResponse,
} from './oauth/dcr-client';

// Workspace
export { WorkspaceManager, SecretDetectedError } from './workspace/workspace-manager';
export type {
  WorkflowIdentity,
  WorkspaceManagerInit,
  BareRepoHandle,
  RunWorkspaceHandle,
  CommitStepOptions,
  CommitStepResult,
} from './workspace/workspace-manager';
export { WorkspaceReader } from './workspace/workspace-reader';
export type { OutputFileEntry, WorkspaceReaderInit } from './workspace/workspace-reader';
export {
  copyOutputFilesIntoWorkspace,
  INTERNAL_OUTPUT_FILE_NAMES,
  PRESENTATION_FILE_NAMES,
  OUTPUT_FILES_REPO_ROOT,
} from './workspace/output-files';

// Testing utilities
export {
  InMemoryAgentEventLog,
  NoopLlmClient,
} from './testing/index';
