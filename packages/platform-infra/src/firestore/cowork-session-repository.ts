import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ZodError } from 'zod';
import {
  CoworkSessionSchema,
  type CoworkSession,
  type ConversationTurn,
  type CoworkSessionRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';

/**
 * Parse a Firestore cowork-session doc against the canonical schema. On
 * schema drift, log the doc id + zod issues then rethrow so the route
 * adapter maps to 500 (PRD §9 rule 3 — never silently swallow drift).
 */
function parseCoworkSessionDoc(data: Record<string, unknown>, docId: string): CoworkSession {
  try {
    return CoworkSessionSchema.parse(sanitizeSessionData(data));
  } catch (err) {
    if (err instanceof ZodError) {
      console.error(
        `[FirestoreCoworkSessionRepository] CoworkSession parse failed for coworkSessions/${docId}:`,
        err.issues,
      );
    }
    throw err;
  }
}

/**
 * Sanitize raw Firestore data before Zod parse.
 * LLMs sometimes return artifact as JSON string instead of object — fix on read.
 */
function sanitizeSessionData(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.artifact === 'string') {
    try {
      data.artifact = JSON.parse(data.artifact);
    } catch {
      data.artifact = null;
    }
  }
  if (Array.isArray(data.turns)) {
    for (const turn of data.turns) {
      const t = turn as Record<string, unknown>;
      if (typeof t.artifactDelta === 'string') {
        try {
          t.artifactDelta = JSON.parse(t.artifactDelta);
        } catch {
          t.artifactDelta = null;
        }
      }
    }
  }
  return data;
}

export class FirestoreCoworkSessionRepository implements CoworkSessionRepository {
  private readonly collectionName = 'coworkSessions';

  constructor(
    private readonly db: Firestore,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(session: CoworkSession): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(session.id).set(session);
    return session;
  }

  async getById(sessionId: string): Promise<CoworkSession | null> {
    const snap = await this.db.collection(this.collectionName).doc(sessionId).get();
    if (!snap.exists) return null;
    return parseCoworkSessionDoc(snap.data() as Record<string, unknown>, sessionId);
  }

  async getByIdInNamespaces(
    sessionId: string,
    allowed: readonly string[],
  ): Promise<CoworkSession | null> {
    const session = await this.getById(sessionId);
    if (session === null) return null;
    const parent = await this.parents.getById(session.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? session : null;
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => parseCoworkSessionDoc(d.data(), d.id));
  }

  async listAll(): Promise<CoworkSession[]> {
    // Caller-scope read path; newest first matches the human-queue convention.
    const snap = await this.db
      .collection(this.collectionName)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => parseCoworkSessionDoc(d.data() as Record<string, unknown>, d.id));
  }

  async listInNamespaces(allowed: readonly string[]): Promise<CoworkSession[]> {
    // CoworkSession has no namespace field; workspace is reached via the
    // parent ProcessInstance. Pre-materialise allowed `processInstanceId`s via
    // one indexed `where('namespace','==',ns)` read per workspace, then a
    // single coworkSessions scan + in-memory join. Same two-pass shape the
    // human-task repo uses (see PR2 #569 perf rationale).
    const allowedInstanceIds = new Set<string>();
    await Promise.all(
      allowed.map(async (ns) => {
        const snap = await this.db
          .collection('processInstances')
          .where('namespace', '==', ns)
          .get();
        for (const doc of snap.docs) allowedInstanceIds.add(doc.id);
      }),
    );
    if (allowedInstanceIds.size === 0) return [];
    const rows = await this.listAll();
    return rows.filter((s) => allowedInstanceIds.has(s.processInstanceId));
  }

  async listByRoleAll(role: string): Promise<CoworkSession[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('assignedRole', '==', role)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => parseCoworkSessionDoc(d.data() as Record<string, unknown>, d.id));
  }

  async listByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<CoworkSession[]> {
    const rows = await this.listByRoleAll(role);
    if (rows.length === 0) return [];
    const instanceIds = [...new Set(rows.map((r) => r.processInstanceId))];
    const namespaceById = new Map<string, string | undefined>();
    await Promise.all(
      instanceIds.map(async (id) => {
        const parent = await this.parents.getById(id);
        namespaceById.set(id, parent?.namespace);
      }),
    );
    return rows.filter((s) => {
      const ns = namespaceById.get(s.processInstanceId);
      return typeof ns === 'string' && allowed.includes(ns);
    });
  }

  async findMostRecentActive(instanceId: string): Promise<CoworkSession | null> {
    // Equality-only query (served by the existing processInstanceId+status
    // index); the most-recent pick is done in memory. An instance has at most
    // a handful of active sessions, so sorting here avoids a third composite
    // index (processInstanceId+status+createdAt) that Firestore would otherwise
    // demand.
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .where('status', '==', 'active')
      .get();
    if (snap.empty) return null;
    const mostRecent = snap.docs.reduce((a, b) =>
      String(a.data().createdAt) >= String(b.data().createdAt) ? a : b,
    );
    return parseCoworkSessionDoc(mostRecent.data(), mostRecent.id);
  }

  async findMostRecentActiveInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<CoworkSession | null> {
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    if (!allowed.includes(parent.namespace)) return null;
    return this.findMostRecentActive(instanceId);
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(sessionId).update({
      turns: FieldValue.arrayUnion(turn),
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async updateTurn(
    sessionId: string,
    turnId: string,
    patch: Partial<ConversationTurn>,
  ): Promise<CoworkSession> {
    // Firestore has no in-place array element update — read, modify, write whole array.
    const session = await this.getById(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const index = session.turns.findIndex((t) => t.id === turnId);
    if (index === -1) throw new Error(`Turn not found: ${turnId}`);
    const existing = session.turns[index];
    const merged = { ...existing, ...patch, id: existing.id, role: existing.role } as ConversationTurn;
    const updatedTurns: ConversationTurn[] = session.turns.map((t, i) => (i === index ? merged : t));
    await this.db.collection(this.collectionName).doc(sessionId).update({
      turns: updatedTurns,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(sessionId).update({
      artifact,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    const now = new Date().toISOString();
    await this.db.collection(this.collectionName).doc(sessionId).update({
      status: 'finalized',
      finalizedAt: now,
      artifact,
      updatedAt: now,
    });
    return (await this.getById(sessionId))!;
  }

  async abandon(sessionId: string): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(sessionId).update({
      status: 'abandoned',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }
}
