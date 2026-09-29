import type { CallerScope } from '../repositories/index';
import { actorFromCaller } from '../handlers/_helpers';

export interface AssistantPromptAudit {
  readonly namespace: string;
  readonly model: string;
  /** The conversation as sent; the latest user message is what gets recorded. */
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
  readonly action: string;
  readonly description: string;
  readonly basis: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Prefix for the log line when the append fails. */
  readonly logTag: string;
}

/**
 * One audit event per assistant request, written before the model is called.
 * Non-fatal: a failed append is logged and the turn goes on, because the audit
 * of an assistant prompt records intent, not a state change.
 */
export async function recordAssistantPrompt(scope: CallerScope, entry: AssistantPromptAudit): Promise<void> {
  const latestUserPrompt = [...entry.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  try {
    await scope.system.audit.append({
      ...actorFromCaller(scope),
      action: entry.action,
      description: entry.description,
      timestamp: new Date().toISOString(),
      inputSnapshot: { prompt: latestUserPrompt, model: entry.model, messageCount: entry.messages.length },
      outputSnapshot: {},
      basis: entry.basis,
      entityType: entry.entityType,
      entityId: entry.entityId,
      namespace: entry.namespace,
    });
  } catch (err) {
    console.error(`[${entry.logTag}] failed to write prompt audit entry (non-fatal):`, err);
  }
}
