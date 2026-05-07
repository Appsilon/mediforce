import type { Firestore } from 'firebase-admin/firestore';
import {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  ConnectionNotOAuthError,
  ConnectionSchema,
  type Connection,
  type ConnectionRepository,
  type ConnectionTokenUpdate,
  type CreateConnectionInput,
  type UpdateConnectionInput,
} from '@mediforce/platform-core';

/** Firestore-backed ConnectionRepository.
 *
 *  Path: namespaces/{namespace}/connections/{id}
 *  Doc id IS the Connection id (slug — see CONNECTION_ID_PATTERN). The id
 *  is stripped from the persisted payload because it already lives on the
 *  doc path. createdAt / updatedAt are managed by the repo (ISO strings);
 *  connectedAt on oauth auth is a unix-ms epoch.
 *
 *  `runWithLock` uses a Firestore transaction so concurrent token-refresh
 *  callers serialize on the document. The transaction reads the current
 *  doc, runs the caller's `fn`, and writes back whatever `fn` produced
 *  (when it returns a Connection). When `fn` does not write — e.g. it
 *  decided no refresh was needed — the transaction performs no `tx.set`. */
export class FirestoreConnectionRepository implements ConnectionRepository {
  constructor(private readonly db: Firestore) {}

  private col(namespace: string) {
    return this.db.collection('namespaces').doc(namespace).collection('connections');
  }

  private toBody(conn: Connection): Record<string, unknown> {
    const { id: _id, ...body } = conn;
    return body;
  }

  private parseDoc(id: string, data: FirebaseFirestore.DocumentData): Connection {
    return ConnectionSchema.parse({ ...data, id });
  }

  async getById(namespace: string, id: string): Promise<Connection | null> {
    const snap = await this.col(namespace).doc(id).get();
    if (!snap.exists) return null;
    return this.parseDoc(snap.id, snap.data() ?? {});
  }

  async list(namespace: string): Promise<Connection[]> {
    const snap = await this.col(namespace).get();
    return snap.docs
      .map((d) => this.parseDoc(d.id, d.data()))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async create(namespace: string, input: CreateConnectionInput): Promise<Connection> {
    const ref = this.col(namespace).doc(input.id);
    const existing = await ref.get();
    if (existing.exists) {
      throw new ConnectionAlreadyExistsError(namespace, input.id);
    }
    const now = new Date().toISOString();
    const conn: Connection = ConnectionSchema.parse({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    await ref.set(this.toBody(conn));
    return conn;
  }

  async update(
    namespace: string,
    id: string,
    patch: UpdateConnectionInput,
  ): Promise<Connection | null> {
    const ref = this.col(namespace).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const current = this.parseDoc(snap.id, snap.data() ?? {});
    const updated: Connection = ConnectionSchema.parse({
      ...current,
      ...patch,
      auth: patch.auth ?? current.auth,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await ref.set(this.toBody(updated));
    return updated;
  }

  async delete(namespace: string, id: string): Promise<boolean> {
    const ref = this.col(namespace).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  async setTokens(
    namespace: string,
    id: string,
    tokens: ConnectionTokenUpdate,
  ): Promise<Connection> {
    const ref = this.col(namespace).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new ConnectionNotFoundError(namespace, id);
      }
      const current = this.parseDoc(snap.id, snap.data() ?? {});
      if (current.auth.type !== 'oauth') {
        throw new ConnectionNotOAuthError(namespace, id);
      }
      const updated: Connection = ConnectionSchema.parse({
        ...current,
        auth: {
          ...current.auth,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? current.auth.refreshToken,
          expiresAt: tokens.expiresAt ?? current.auth.expiresAt,
          scope: tokens.scope ?? current.auth.scope,
          providerUserId: tokens.providerUserId ?? current.auth.providerUserId,
          accountLogin: tokens.accountLogin ?? current.auth.accountLogin,
          connectedBy: tokens.connectedBy ?? current.auth.connectedBy,
          connectedAt: Date.now(),
        },
        updatedAt: new Date().toISOString(),
      });
      // Use `merge: true` so any unknown top-level fields written by a
      // newer deploy in a rolling-deploy scenario are preserved instead of
      // wiped — `.strict()` parse strips them from our typed view but the
      // doc itself keeps them. Token fields land via the merged `auth`
      // map (which is a single field, replaced wholesale — that's fine,
      // tokens belong together).
      tx.set(ref, this.toBody(updated), { merge: true });
      return updated;
    });
  }
}
