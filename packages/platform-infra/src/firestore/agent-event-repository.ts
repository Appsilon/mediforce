import type { Firestore } from 'firebase-admin/firestore';
import { ZodError } from 'zod';
import {
  AgentEventSchema,
  type AgentEvent,
  type AgentEventRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';

/**
 * Firestore implementation of `AgentEventRepository` — read-only port over
 * the existing `processInstances/{instanceId}/agentEvents/{eventId}`
 * subcollection that `FirestoreAgentEventLog` (in `agent-runtime`) writes to.
 *
 * The write path stays in `agent-runtime` for now: it carries an in-memory
 * cache + per-step serialization that doesn't belong on the read port.
 * Unifying both behind one repository is tracked as a post-phase-4 follow-up.
 */
export class FirestoreAgentEventRepository implements AgentEventRepository {
  constructor(
    private readonly db: Firestore,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async listByInstance(
    instanceId: string,
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    const base = this.db
      .collection('processInstances')
      .doc(instanceId)
      .collection('agentEvents');
    const filtered =
      afterSequence === undefined
        ? base
        : base.where('sequence', '>', afterSequence);
    const snap = await filtered.orderBy('sequence', 'asc').get();
    return snap.docs.map((d) => parseAgentEventDoc(d.data(), instanceId, d.id));
  }

  async listByStep(
    instanceId: string,
    stepId: string,
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    const base = this.db
      .collection('processInstances')
      .doc(instanceId)
      .collection('agentEvents')
      .where('stepId', '==', stepId);
    const filtered =
      afterSequence === undefined
        ? base
        : base.where('sequence', '>', afterSequence);
    const snap = await filtered.orderBy('sequence', 'asc').get();
    return snap.docs.map((d) => parseAgentEventDoc(d.data(), instanceId, d.id));
  }

  async listByInstanceInNamespaces(
    instanceId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.listByInstance(instanceId, afterSequence);
  }

  async listByStepInNamespaces(
    instanceId: string,
    stepId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.listByStep(instanceId, stepId, afterSequence);
  }
}

/**
 * Parse one Firestore doc into an `AgentEvent`. Per PRD §9 a `ZodError`
 * here is a genuine schema-drift signal — log loudly + rethrow so the
 * route maps to 500 rather than silently returning a corrupted feed.
 *
 * The doc id is the authoritative `id`; legacy docs may have inconsistent
 * `processInstanceId` so we restore it from the path.
 */
function parseAgentEventDoc(
  data: Record<string, unknown> | undefined,
  instanceId: string,
  docId: string,
): AgentEvent {
  try {
    return AgentEventSchema.parse({
      ...(data ?? {}),
      id: docId,
      processInstanceId: instanceId,
    });
  } catch (err) {
    // PRD §9: log loudly + rethrow so the route maps to 500 rather than
    // silently swallowing schema drift.
    if (err instanceof ZodError) {
      console.error(
        `[FirestoreAgentEventRepository] AgentEvent parse failed for processInstances/${instanceId}/agentEvents/${docId}:`,
        err.issues,
      );
    }
    throw err;
  }
}
