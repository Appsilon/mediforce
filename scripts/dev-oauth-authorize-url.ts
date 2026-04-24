/**
 * Dev helper: mint a state HMAC for the platform OAuth flow and print the
 * authorize URL to click. Self-contained — inlines the HMAC logic so it
 * runs via `npx tsx` without workspace resolution.
 */

import { webcrypto } from 'node:crypto';

const crypto = webcrypto;

interface OAuthStatePayload {
  namespace: string;
  agentId: string;
  serverName: string;
  providerId: string;
  connectedBy: string;
  ts: number;
  nonce: string;
  codeVerifier?: string;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

async function signState(payload: OAuthStatePayload, secret: string): Promise<string> {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = base64urlEncode(payloadBytes);
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${base64urlEncode(sig)}`;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

async function generatePkcePair(): Promise<PkcePair> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const codeVerifier = base64urlEncode(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64urlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

interface Args {
  namespace: string;
  agent: string;
  server: string;
  provider: string;
  uid: string;
  origin: string;
}

function parseArgs(): Args {
  const map = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key.startsWith('--')) continue;
    const value = process.argv[i + 1];
    if (value === undefined) continue;
    map.set(key.slice(2), value);
    i += 1;
  }
  const required = ['namespace', 'agent', 'server', 'provider', 'uid'] as const;
  for (const key of required) {
    if (!map.has(key)) {
      console.error(`Missing required flag: --${key}`);
      process.exit(2);
    }
  }
  return {
    namespace: map.get('namespace')!,
    agent: map.get('agent')!,
    server: map.get('server')!,
    provider: map.get('provider')!,
    uid: map.get('uid')!,
    origin: map.get('origin') ?? 'http://localhost:9003',
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const platformSecret = process.env.PLATFORM_API_KEY;
  if (platformSecret === undefined || platformSecret === '') {
    console.error('PLATFORM_API_KEY must be exported in the environment');
    process.exit(2);
  }
  // Admin routes (/api/admin/oauth-providers/**) require the dedicated
  // PLATFORM_ADMIN_API_KEY when hit via X-Api-Key. Falls back to
  // PLATFORM_API_KEY only if you've consciously aliased them in dev.
  const adminApiKey = process.env.PLATFORM_ADMIN_API_KEY ?? process.env.MEDIFORCE_API_KEY ?? platformSecret;

  const listResp = await fetch(
    `${args.origin}/api/admin/oauth-providers?namespace=${args.namespace}`,
    { headers: { 'X-Api-Key': adminApiKey } },
  );
  if (!listResp.ok) {
    console.error(`Failed to list providers (${listResp.status})`);
    process.exit(3);
  }
  const listBody = (await listResp.json()) as {
    providers: Array<{ id: string; authorizeUrl: string; clientId: string; scopes: string[] }>;
  };
  const provider = listBody.providers.find((p) => p.id === args.provider);
  if (provider === undefined) {
    console.error(`Provider "${args.provider}" not found in namespace "${args.namespace}"`);
    process.exit(4);
  }

  const pkce = await generatePkcePair();

  const state = await signState(
    {
      namespace: args.namespace,
      agentId: args.agent,
      serverName: args.server,
      providerId: args.provider,
      connectedBy: args.uid,
      ts: Date.now(),
      nonce: generateNonce(),
      codeVerifier: pkce.codeVerifier,
    },
    platformSecret,
  );

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set(
    'redirect_uri',
    `${args.origin}/api/oauth/${encodeURIComponent(args.provider)}/callback`,
  );
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  console.log(url.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
