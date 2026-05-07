import type {
  AgentEvent,
  ProcessConfig,
  PluginCapabilityMetadata,
  ResolvedMcpConfig,
  WorkflowDefinition,
  WorkflowStep,
} from '@mediforce/platform-core';

export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LlmClient {
  complete(messages: LlmMessage[], model?: string): Promise<LlmResponse>;
}

/**
 * @deprecated Use WorkflowAgentContext instead. AgentContext relies on the legacy
 * ProcessConfig / StepConfig model which is being replaced by WorkflowDefinition / WorkflowStep.
 */
export interface AgentContext {
  stepId: string;
  processInstanceId: string;
  definitionVersion: string;
  stepInput: Record<string, unknown>;
  autonomyLevel: AutonomyLevel;
  config: ProcessConfig;
  llm: LlmClient;
  getPreviousStepOutputs: () => Promise<Record<string, unknown>>;
}

/** OAuth token context passed into a workflow agent run, keyed by the MCP
 *  server name on the agent's binding map. Carries the already-loaded
 *  access token plus the binding's header injection settings so the
 *  runtime writer can synthesize a single header without reaching back
 *  into Firestore. Producing this map is the caller's job (platform-ui's
 *  `execute-agent-step`): load the token, refresh if close to expiry,
 *  persist the refresh, then hand the resolved bundle to the context.
 *  Keeping the runtime decoupled from repos is what lets queued-docker
 *  spawn serialize the context through BullMQ without a Firestore trip. */
export interface ResolvedOAuthBinding {
  /** Fresh OAuth access token, ready to render into the header value. */
  accessToken: string;
  /** Name of the HTTP header to emit (e.g. "Authorization"). */
  headerName: string;
  /** Template for the header value; `{token}` is replaced with
   *  `accessToken` via `renderOAuthHeader`. (e.g. "Bearer {token}"). */
  headerValueTemplate: string;
}

/**
 * Agent execution context built from the unified WorkflowDefinition model.
 * Replaces AgentContext — plugins read agent config from step.agent,
 * env from step.env merged with workflowDefinition.env.
 */
export interface WorkflowAgentContext {
  stepId: string;
  processInstanceId: string;
  definitionVersion: string;
  stepInput: Record<string, unknown>;
  autonomyLevel: AutonomyLevel;
  workflowDefinition: WorkflowDefinition;
  step: WorkflowStep;
  llm: LlmClient;
  getPreviousStepOutputs: () => Promise<Record<string, unknown>>;
  /** Pre-fetched workflow secrets for {{TEMPLATE}} resolution */
  workflowSecrets?: Record<string, string>;
  /** Pre-resolved MCP configuration for this step. Produced by
   *  resolveMcpForStep at handoff time: AgentDefinition + step
   *  restrictions + tool catalog collapsed into a flat map of server
   *  name → launch spec. undefined when step.agentId is unset. */
  resolvedMcpConfig?: ResolvedMcpConfig;
  /**
   * Snapshot of outputs carried over from the last successfully completed run
   * of the same workflow name, per the WD's `inputForNextRun` declarations.
   * `{}` when carry-over is declared but no predecessor qualified (first run,
   * or all previous failed). Undefined when the WD declares no carry-over.
   */
  previousRun?: Record<string, unknown>;
  /** Pre-loaded OAuth tokens keyed by MCP server name. Populated by
   *  platform-ui's executeAgentStep for every HTTP binding whose auth
   *  config is `{ type: 'oauth', ... }`. Consumed by writeMcpConfig to
   *  synthesize the Authorization header at spawn time. */
  oauthTokens?: Record<string, ResolvedOAuthBinding>;
  /** Pre-assembled prompt sections from the AgentDefinition referenced by
   *  step.agentId: the agent's systemPrompt + resolved skill file contents.
   *  Populated by platform-ui's executeAgentStep (downloads from Storage).
   *  Injected into buildPrompt() after the workflow preamble. */
  agentIdentityPrompt?: string;
  /** Pre-resolved env vars for `step.connections` — `CONN_<ID>_TOKEN` per
   *  Connection plus provider `envAlias` entries (`GITHUB_TOKEN` etc.)
   *  when unambiguous. Populated by `resolveConnectionEnv` before plugin
   *  invocation so the runtime stays decoupled from Firestore. Plugins
   *  merge this into their own env map at spawn time. */
  resolvedConnectionEnv?: Record<string, string>;
  /** Pre-resolved Connection-backed env additions for stdio MCP servers,
   *  keyed by server name (matches `resolvedMcpConfig.servers`). Each
   *  entry is the env-var bundle to merge into that server's `extraEnv`
   *  before mcp-config.json is written — typically a single
   *  `CONN_<NORMALIZED_ID>_TOKEN` from the Connection that the stdio
   *  catalog entry references. Populated by executeAgentStep alongside
   *  `oauthTokens` so the writer never reaches back into Firestore. */
  stdioConnectionEnvByServer?: Record<string, Record<string, string>>;
}

// EmitFn: platform assigns id and sequence — plugin provides type, payload, timestamp
export type EmitPayload = Omit<AgentEvent, 'id' | 'sequence' | 'processInstanceId' | 'stepId'>;
export type EmitFn = (event: EmitPayload) => Promise<void>;

export interface AgentPlugin {
  metadata?: PluginCapabilityMetadata;
  initialize(context: AgentContext | WorkflowAgentContext): Promise<void>;
  run(emit: EmitFn): Promise<void>;
}
