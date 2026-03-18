// Interfaces
export type {
  AutonomyLevel,
  LlmMessage,
  LlmResponse,
  LlmClient,
  AgentContext,
  WorkflowAgentContext,
  EmitPayload,
  EmitFn,
  AgentPlugin,
  ReviewPlugin,
  ReviewPluginContext,
  ReviewPluginResult,
  ReviewVerdict,
} from './interfaces/index.js';

// Plugins
export { BaseContainerAgentPlugin, isLocalExecutionAllowed } from './plugins/base-container-agent-plugin.js';
export type { AgentCommandSpec, SpawnCliOptions, SpawnDockerResult } from './plugins/base-container-agent-plugin.js';
export { ClaudeCodeAgentPlugin } from './plugins/claude-code-agent-plugin.js';
export { MockClaudeCodeAgentPlugin } from './plugins/mock-claude-code-agent-plugin.js';
export { OpenCodeAgentPlugin } from './plugins/opencode-agent-plugin.js';
export { ScriptContainerPlugin } from './plugins/script-container-plugin.js';

// Runner
export type { AgentEventLog } from './runner/agent-event-log.js';
export { FirestoreAgentEventLog } from './runner/agent-event-log.js';
export { PluginRegistry, PluginNotFoundError } from './runner/plugin-registry.js';
export { OpenRouterLlmClient } from './runner/llm-client.js';
export { AgentRunner } from './runner/agent-runner.js';
export type { AgentRunResult } from './runner/agent-runner.js';
export { FallbackHandler } from './runner/fallback-handler.js';

// Testing utilities
export {
  InMemoryAgentEventLog,
  NoopLlmClient,
} from './testing/index.js';
