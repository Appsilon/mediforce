import type { NamespaceSecretsRepository, WorkflowSecretsRepository } from '@mediforce/platform-core';

/**
 * Minimal in-memory `NamespaceSecretsRepository` for handler tests. Reads off
 * a plain object; writes mutate it. Sufficient to exercise the wrapper's
 * read / write gate and the handler's dispatch logic — not a general-purpose
 * fake (no encryption, no audit).
 */
export function buildNamespaceSecretsRepo(
  seed: Record<string, Record<string, string>> = {},
): NamespaceSecretsRepository {
  const store: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(seed));
  return {
    async getSecrets(namespace) {
      return { ...(store[namespace] ?? {}) };
    },
    async getSecretKeys(namespace) {
      return Object.keys(store[namespace] ?? {});
    },
    async setSecrets(namespace, secrets) {
      store[namespace] = { ...secrets };
    },
    async upsertSecret(namespace, key, value) {
      store[namespace] = { ...(store[namespace] ?? {}), [key]: value };
    },
    async deleteSecret(namespace, key) {
      if (!store[namespace]) return;
      const next = { ...store[namespace] };
      delete next[key];
      store[namespace] = next;
    },
  };
}

/**
 * Same idea, scoped to (namespace, workflow). Mirrors the wire shape of the
 * production `WorkflowSecretsRepository`.
 */
export function buildWorkflowSecretsRepo(
  seed: Record<string, Record<string, Record<string, string>>> = {},
): WorkflowSecretsRepository {
  const store: Record<string, Record<string, Record<string, string>>> = JSON.parse(JSON.stringify(seed));
  return {
    async getSecrets(namespace, workflow) {
      return { ...((store[namespace] ?? {})[workflow] ?? {}) };
    },
    async getSecretKeys(namespace, workflow) {
      return Object.keys((store[namespace] ?? {})[workflow] ?? {});
    },
    async setSecrets(namespace, workflow, secrets) {
      store[namespace] = { ...(store[namespace] ?? {}), [workflow]: { ...secrets } };
    },
    async deleteSecrets(namespace, workflow) {
      if (!store[namespace]) return;
      const next = { ...store[namespace] };
      delete next[workflow];
      store[namespace] = next;
    },
    async deleteSecret(namespace, workflow, key) {
      const wf = store[namespace]?.[workflow];
      if (!wf) return;
      const next = { ...wf };
      delete next[key];
      store[namespace] = { ...store[namespace], [workflow]: next };
    },
    async upsertSecret(namespace, workflow, key, value) {
      const ns = store[namespace] ?? {};
      ns[workflow] = { ...(ns[workflow] ?? {}), [key]: value };
      store[namespace] = ns;
    },
  };
}
