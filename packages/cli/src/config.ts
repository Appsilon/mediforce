/**
 * Resolves the runtime config for every CLI invocation.
 *
 * Precedence:
 *   - apiKey:  MEDIFORCE_API_KEY > PLATFORM_API_KEY (env only — not configurable via flag)
 *   - baseUrl: --base-url flag > MEDIFORCE_BASE_URL env > DEFAULT_BASE_URL
 *
 * Pure function — pass `env` and `flagBaseUrl` explicitly so tests don't need
 * to mutate `process.env`.
 */

export const DEFAULT_BASE_URL = 'http://localhost:9003';

export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
}

export interface ResolveConfigInput {
  flagBaseUrl?: string | undefined;
  env: Record<string, string | undefined>;
}

export function resolveApiKey(env: Record<string, string | undefined>): string {
  const fromMediforce = env['MEDIFORCE_API_KEY'];
  if (typeof fromMediforce === 'string' && fromMediforce.length > 0) {
    return fromMediforce;
  }
  const fromPlatform = env['PLATFORM_API_KEY'];
  if (typeof fromPlatform === 'string' && fromPlatform.length > 0) {
    return fromPlatform;
  }
  throw new Error(
    'mediforce: missing API key. Set MEDIFORCE_API_KEY (or PLATFORM_API_KEY).',
  );
}

export function resolveBaseUrl(input: ResolveConfigInput): string {
  if (typeof input.flagBaseUrl === 'string' && input.flagBaseUrl.length > 0) {
    return input.flagBaseUrl;
  }
  const fromEnv = input.env['MEDIFORCE_BASE_URL'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_BASE_URL;
}

export function resolveConfig(input: ResolveConfigInput): ResolvedConfig {
  return {
    apiKey: resolveApiKey(input.env),
    baseUrl: resolveBaseUrl(input),
  };
}
