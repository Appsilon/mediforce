import type { AgentOutputEnvelope } from '@mediforce/platform-core';
import type { LlmClient } from './agent-plugin.js';

export interface ReviewPluginContext {
  stepId: string;
  processInstanceId: string;
  executorOutput: AgentOutputEnvelope;
  iterationNumber: number;
  previousFeedback?: string; // from prior review rejection
  llm: LlmClient;
}

export type ReviewVerdict = 'approve' | 'reject' | 'revise';

export interface ReviewPluginResult {
  verdict: ReviewVerdict;
  reasoning: string;
  feedback?: string; // provided on reject/revise for executor re-invocation
  confidence: number;
}

export interface ReviewPlugin {
  review(context: ReviewPluginContext): Promise<ReviewPluginResult>;
}
