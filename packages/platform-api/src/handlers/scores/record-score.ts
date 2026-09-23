import { randomUUID } from 'node:crypto';
import type { Score } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';

export type RecordScoreInput = Omit<Score, 'id' | 'createdAt'> & {
  /** The rule the judgment was made under, for the audit event's `basis`. */
  readonly basis: string;
};

const ACTOR_TYPE_BY_SOURCE = {
  human: 'user',
  llm_judge: 'agent',
  deterministic: 'system',
} as const;

/**
 * Append a Score, then the `score.created` audit event that records it
 * (ADR-0007 D2, 21 CFR Part 11). Every Score write goes through here. The two
 * are separate writes — there is no cross-repository transaction yet (ADR-0005
 * §7, #516) — so a failed audit append leaves the Score stored unaudited.
 */
export async function recordScore(input: RecordScoreInput, scope: CallerScope): Promise<Score> {
  const { basis, ...fields } = input;
  const score = await scope.scores.create({
    ...fields,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  await scope.system.audit.append({
    actorId: score.createdBy ?? `${score.source}:${score.evaluatorId ?? score.name}`,
    actorType: ACTOR_TYPE_BY_SOURCE[score.source],
    actorRole: score.source === 'human' ? 'reviewer' : score.source,
    action: 'score.created',
    description: `Score '${score.name}' = ${score.value} recorded on ${score.subject.type} '${score.subject.id}'`,
    timestamp: score.createdAt,
    inputSnapshot: { subject: score.subject, name: score.name, stepId: score.stepId },
    outputSnapshot: {
      value: score.value,
      label: score.label,
      comment: score.comment,
      ...(score.supersedes !== null ? { supersedes: score.supersedes } : {}),
    },
    basis,
    entityType: 'score',
    entityId: score.id,
    namespace: score.namespace,
    ...(score.processInstanceId !== null ? { processInstanceId: score.processInstanceId } : {}),
    ...(score.stepId !== null ? { stepId: score.stepId } : {}),
  });

  return score;
}
