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
}

// EmitFn: platform assigns id and sequence — plugin provides type, payload, timestamp
export type EmitPayload = Omit<AgentEvent, 'id' | 'sequence' | 'processInstanceId' | 'stepId'>;
export type EmitFn = (event: EmitPayload) => Promise<void>;

export interface AgentPlugin {
  metadata?: PluginCapabilityMetadata;
  initialize(context: AgentContext | WorkflowAgentContext): Promise<void>;
  run(emit: EmitFn): Promise<void>;
}
