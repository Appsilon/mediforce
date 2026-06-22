import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import type { LlmMessage, WorkflowAgentContext } from '../interfaces/step-executor-plugin';

const TRACER_NAME = '@mediforce/agent-runtime';

export interface OpenTelemetryTracingOptions {
  captureContent?: boolean;
}

interface AgentRunSpanResult {
  status: string;
  appliedToWorkflow: boolean;
  fallbackReason: 'timeout' | 'low_confidence' | 'error' | null;
  envelopeModel?: string | null;
  /** Envelope result to record as output.value — only pass when content
   *  capture is enabled (ADR-0007 D5: may contain patient data). */
  capturedResult?: unknown;
}

interface LlmSpanInput {
  messages: LlmMessage[];
  selectedModel: string;
  captureContent: boolean;
}

function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

function recordError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function withAgentRunSpan<T>(
  agentRunId: string,
  context: WorkflowAgentContext,
  options: OpenTelemetryTracingOptions,
  callback: (span: Span) => Promise<T>,
): Promise<T> {
  const attributes: Attributes = {
    // OpenInference span kind — trace viewers (Phoenix) use it to type and
    // render the span (icons, input/output panels).
    'openinference.span.kind': 'AGENT',
    'mediforce.agent_run.id': agentRunId,
    'mediforce.process_instance.id': context.processInstanceId,
    'mediforce.namespace': context.runNamespace,
    'mediforce.workflow.name': context.workflowDefinition.name,
    'mediforce.workflow.version': context.workflowDefinition.version,
    'mediforce.workflow.step_id': context.stepId,
    'mediforce.agent.autonomy_level': context.autonomyLevel,
  };

  if (context.step.agent?.model !== undefined) {
    attributes['gen_ai.request.model'] = context.step.agent.model;
  }

  if (options.captureContent === true) {
    attributes['input.value'] = JSON.stringify(context.stepInput);
    attributes['input.mime_type'] = 'application/json';
  }

  // Final span status is set by annotateAgentRunSpan (every terminal path
  // calls it): the runner resolves normally on timeout/error fallbacks, so
  // a blanket OK here would mask failed runs in trace viewers.
  // root: true — host-framework spans (e.g. Next.js HTTP auto-instrumentation)
  // are filtered out of export, so parenting under them would orphan the trace.
  return getTracer().startActiveSpan('mediforce.agent.run', { attributes, root: true }, async (span) => {
    try {
      return await callback(span);
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function annotateAgentRunSpan(span: Span, result: AgentRunSpanResult): void {
  span.setAttributes({
    'mediforce.agent_run.status': result.status,
    'mediforce.agent_run.applied_to_workflow': result.appliedToWorkflow,
  });

  if (result.fallbackReason !== null) {
    span.setAttribute('mediforce.agent_run.fallback_reason', result.fallbackReason);
  }

  if (result.envelopeModel !== undefined && result.envelopeModel !== null) {
    span.setAttribute('gen_ai.response.model', result.envelopeModel);
  }

  if (result.capturedResult !== undefined) {
    span.setAttributes({
      'output.value': JSON.stringify(result.capturedResult),
      'output.mime_type': 'application/json',
    });
  }

  if (result.fallbackReason === 'timeout' || result.fallbackReason === 'error') {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `agent run fell back: ${result.fallbackReason}`,
    });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
}

export async function withOpenRouterLlmSpan<T>(input: LlmSpanInput, callback: (span: Span) => Promise<T>): Promise<T> {
  const attributes: Attributes = {
    'openinference.span.kind': 'LLM',
    'gen_ai.request.model': input.selectedModel,
    'mediforce.llm.provider': 'openrouter',
    'mediforce.llm.message_count': input.messages.length,
  };

  if (input.captureContent) {
    input.messages.forEach((message, index) => {
      attributes[`gen_ai.prompt.${index}.role`] = message.role;
      attributes[`gen_ai.prompt.${index}.content`] = message.content;
    });
  }

  return getTracer().startActiveSpan('openrouter.chat.completion', { attributes }, async (span) => {
    try {
      const result = await callback(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function annotateOpenRouterLlmSpan(
  span: Span,
  response: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    content?: string;
  },
  captureContent: boolean,
): void {
  span.setAttributes({
    'gen_ai.response.model': response.model,
    'gen_ai.usage.input_tokens': response.promptTokens,
    'gen_ai.usage.output_tokens': response.completionTokens,
  });

  if (captureContent === true) {
    span.setAttributes({
      'gen_ai.completion.0.role': 'assistant',
      'gen_ai.completion.0.content': response.content ?? '',
    });
  }
}
