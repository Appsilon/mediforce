import type { CallerScope } from '../../../repositories/index';
import { actorFromCaller } from '../../_helpers';

export interface EvaluationAuditEntry {
  readonly action: string;
  readonly description: string;
  readonly namespace: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly inputSnapshot: Record<string, unknown>;
  readonly outputSnapshot?: Record<string, unknown>;
  readonly basis: string;
}

/** One audit event per Evaluation write (ADR-0007 D2), as the caller. */
export async function appendEvaluationAudit(scope: CallerScope, entry: EvaluationAuditEntry): Promise<void> {
  await scope.system.audit.append({
    ...actorFromCaller(scope, 'evaluation-author'),
    action: entry.action,
    description: entry.description,
    timestamp: new Date().toISOString(),
    inputSnapshot: entry.inputSnapshot,
    outputSnapshot: entry.outputSnapshot ?? {},
    basis: entry.basis,
    entityType: entry.entityType,
    entityId: entry.entityId,
    namespace: entry.namespace,
  });
}

/** Who a row records as its author. */
export function authorId(scope: CallerScope): string {
  return actorFromCaller(scope).actorId;
}
