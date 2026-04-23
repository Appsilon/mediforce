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
} from './interfaces/index.js';

// Plugins
export { BaseContainerAgentPlugin, isLocalExecutionAllowed, OAuthTokenUnavailableError } from './plugins/base-container-agent-plugin.js';
export type { AgentCommandSpec, SpawnCliOptions, SpawnDockerResult } from './plugins/base-container-agent-plugin.js';
export { ClaudeCodeAgentPlugin } from './plugins/claude-code-agent-plugin.js';
export { MockClaudeCodeAgentPlugin } from './plugins/mock-claude-code-agent-plugin.js';
export { OpenCodeAgentPlugin } from './plugins/opencode-agent-plugin.js';
export { ScriptContainerPlugin } from './plugins/script-container-plugin.js';
export type { DockerSpawnStrategy, DockerSpawnRequest, DockerSpawnResult } from './plugins/docker-spawn-strategy.js';

// Runner
export type { AgentEventLog } from './runner/agent-event-log.js';
export { FirestoreAgentEventLog } from './runner/agent-event-log.js';
export { PluginRegistry, PluginNotFoundError } from './runner/plugin-registry.js';
export { OpenRouterLlmClient } from './runner/llm-client.js';
export { AgentRunner } from './runner/agent-runner.js';
export type { AgentRunResult } from './runner/agent-runner.js';
export { FallbackHandler } from './runner/fallback-handler.js';

// Env validation
export { validateWorkflowEnv } from './plugins/resolve-env.js';
export type { MissingEnvVar } from './plugins/resolve-env.js';

// MCP resolution helpers
export { resolveMcpForStep, AgentDefinitionNotFoundError } from './mcp/resolve-mcp-for-step.js';
export type { ResolveMcpForStepDeps } from './mcp/resolve-mcp-for-step.js';
export { flattenResolvedMcpToLegacy } from './mcp/flatten-resolved-mcp.js';

// OAuth (Step 5)
export {
  signState,
  verifyState,
  generateNonce,
  type OAuthStatePayload,
} from './oauth/state-hmac.js';
export {
  REFRESH_MARGIN_MS,
  RefreshTokenRejectedError,
  RefreshTokenUnavailableError,
  renderOAuthHeader,
  resolveOAuthToken,
  type ResolvedToken,
  type ResolveTokenOptions,
} from './oauth/resolve-oauth-token.js';

// Testing utilities
export {
  InMemoryAgentEventLog,
  NoopLlmClient,
} from './testing/index.js';
