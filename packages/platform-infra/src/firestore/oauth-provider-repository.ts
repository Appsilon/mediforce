import type { Firestore } from 'firebase-admin/firestore';
import {
  OAuthProviderConfigSchema,
  ProviderAlreadyExistsError,
  type CreateOAuthProviderInput,
  type OAuthProviderConfig,
  type OAuthProviderRepository,
  type UpdateOAuthProviderInput,
} from '@mediforce/platform-core';

/** Firestore-backed OAuthProviderRepository.
 *
 *  Path: namespaces/{namespace}/oauthProviders/{providerId}
 *  Doc id IS the provider id (slug — see schema regex). The id is stripped
 *  from the persisted payload since it already lives in the doc path.
 *  `createdAt` / `updatedAt` are managed by the repo (ISO strings). */
export class FirestoreOAuthProviderRepository implements OAuthProviderRepository {
  constructor(private readonly db: Firestore) {}

  private col(namespace: string) {
    return this.db.collection('namespaces').doc(namespace).collection('oauthProviders');
  }

  async list(namespace: string): Promise<OAuthProviderConfig[]> {
    const snap = await this.col(namespace).get();
    return snap.docs
      .map((d) => OAuthProviderConfigSchema.parse({ ...d.data(), id: d.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(namespace: string, id: string): Promise<OAuthProviderConfig | null> {
    const snap = await this.col(namespace).doc(id).get();
    if (!snap.exists) return null;
    return OAuthProviderConfigSchema.parse({ ...snap.data(), id: snap.id });
  }

  async create(
    namespace: string,
    input: CreateOAuthProviderInput,
  ): Promise<OAuthProviderConfig> {
    const ref = this.col(namespace).doc(input.id);
    const existing = await ref.get();
    if (existing.exists) {
      throw new ProviderAlreadyExistsError(namespace, input.id);
    }
    const now = new Date().toISOString();
    const config: OAuthProviderConfig = OAuthProviderConfigSchema.parse({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    const { id, ...body } = config;
    await ref.set(body);
    return config;
  }

  async update(
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null> {
    const ref = this.col(namespace).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const current = OAuthProviderConfigSchema.parse({ ...snap.data(), id: snap.id });
    const updated: OAuthProviderConfig = OAuthProviderConfigSchema.parse({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const { id: _persistedId, ...body } = updated;
    await ref.set(body);
    return updated;
  }

  async delete(namespace: string, id: string): Promise<boolean> {
    const ref = this.col(namespace).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }
}
