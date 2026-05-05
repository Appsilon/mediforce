import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OAuthProviderRepository } from '@mediforce/platform-core';
import {
  OAuthProviderSeedFileSchema,
  type OAuthProviderSeedEntry,
  type CreateOAuthProviderInput,
} from '@mediforce/platform-core';

/** Boot-time loader for `data/seeds/oauth-providers.json`.
 *
 *  The JSON carries provider URLs, scopes, and the *names* of env vars that
 *  hold per-deployment client credentials. At seed time we resolve those env
 *  vars and upsert into Firestore at `namespaces/{ns}/oauthProviders/{id}`.
 *
 *  Per-deployment isolation: same JSON in every deployment, different env
 *  → different OAuth Apps registered on the provider side. Entries whose
 *  required env vars are not set are skipped with a warning so a deployment
 *  that doesn't use a given provider boots cleanly. */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/platform-api/dist/services -> repo root
// packages/platform-api/src/services   -> repo root (also 4 levels up via @mediforce/source)
const SEED_PATH = resolve(__dirname, '../../../../data/seeds/oauth-providers.json');

interface ResolvedSeed {
  namespace: string;
  input: CreateOAuthProviderInput;
}

interface ResolutionResult {
  resolved: ResolvedSeed[];
  skipped: { namespace: string; id: string; missing: string[] }[];
}

export function resolveOAuthProviderSeeds(
  file: Record<string, OAuthProviderSeedEntry[]>,
  env: Record<string, string | undefined>,
): ResolutionResult {
  const resolved: ResolvedSeed[] = [];
  const skipped: ResolutionResult['skipped'] = [];

  for (const [namespace, entries] of Object.entries(file)) {
    for (const entry of entries) {
      const clientId = env[entry.clientIdEnv];
      const clientSecret = entry.clientSecretEnv !== undefined
        ? env[entry.clientSecretEnv]
        : undefined;

      const missing: string[] = [];
      if (clientId === undefined || clientId === '') missing.push(entry.clientIdEnv);
      if (
        entry.clientSecretEnv !== undefined
        && (clientSecret === undefined || clientSecret === '')
      ) {
        missing.push(entry.clientSecretEnv);
      }
      if (missing.length > 0) {
        skipped.push({ namespace, id: entry.id, missing });
        continue;
      }

      const input: CreateOAuthProviderInput = {
        id: entry.id,
        name: entry.name,
        authorizeUrl: entry.authorizeUrl,
        tokenUrl: entry.tokenUrl,
        scopes: entry.scopes,
        clientId: clientId as string,
        ...(clientSecret !== undefined ? { clientSecret } : {}),
        ...(entry.revokeUrl !== undefined ? { revokeUrl: entry.revokeUrl } : {}),
        ...(entry.userInfoUrl !== undefined ? { userInfoUrl: entry.userInfoUrl } : {}),
        ...(entry.tokenEndpointAuthMethod !== undefined
          ? { tokenEndpointAuthMethod: entry.tokenEndpointAuthMethod }
          : {}),
        ...(entry.iconUrl !== undefined ? { iconUrl: entry.iconUrl } : {}),
      };
      resolved.push({ namespace, input });
    }
  }

  return { resolved, skipped };
}

function loadSeedFile(): Record<string, OAuthProviderSeedEntry[]> {
  const raw = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as unknown;
  return OAuthProviderSeedFileSchema.parse(raw);
}

export async function seedBuiltinOAuthProviders(
  repo: OAuthProviderRepository,
): Promise<void> {
  const file = loadSeedFile();
  const { resolved, skipped } = resolveOAuthProviderSeeds(file, process.env);

  for (const { namespace, id, missing } of skipped) {
    console.warn(
      `[seed-oauth-providers] Skipping ${namespace}/${id} — missing env vars: ${missing.join(', ')}`,
    );
  }

  await Promise.all(
    resolved.map(({ namespace, input }) => repo.upsert(namespace, input)),
  );

  if (resolved.length > 0) {
    console.log(`[seed-oauth-providers] Upserted ${resolved.length} provider(s).`);
  }
}
