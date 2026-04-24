/**
 * Stateless OAuth state token — HMAC-SHA256 over a JSON payload, base64url
 * encoded. Avoids any server-side state storage/TTL cleanup.
 *
 *   state = base64url(payload) + "." + base64url(HMAC-SHA256(secret, base64url(payload)))
 *
 * Verification: split on ".", recompute HMAC, constant-time compare, then
 * parse the payload and enforce `ts < now - maxAgeMs`. Any deviation fails
 * (tampering, expired, malformed) — all paths return null, caller maps to 400.
 */

function base64urlEncode(bytes: Uint8Array): string {
  // btoa expects binary string; atob returns one. Small loop avoids
  // Buffer/TextDecoder imports so this works in both Node and Edge.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  const binary = atob(padded + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const keyBytes = new TextEncoder().encode(secret);
  const messageBytes = new TextEncoder().encode(message);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, messageBytes);
  return new Uint8Array(signature);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface OAuthStatePayload {
  namespace: string;
  agentId: string;
  serverName: string;
  providerId: string;
  /** Firebase uid of the user who initiated the flow. Callback has no
   *  session, so we carry this through the state to attribute audit fields. */
  connectedBy: string;
  /** Unix ms at which this state was minted. Used for TTL enforcement. */
  ts: number;
  /** 16 random bytes, base64url — prevents replay of identical payloads. */
  nonce: string;
  /** PKCE code_verifier (RFC 7636). Present when the authorize URL was
   *  built with a code_challenge; callback must echo it back at token
   *  exchange. Carried inside the state HMAC — signed but not encrypted,
   *  so treat the verifier as a single-use secret and keep state TTL
   *  short (10 min). Absent for legacy pre-Step-5 flows that never used
   *  PKCE against GitHub/Google OAuth Apps. */
  codeVerifier?: string;
}

/** Sign a state payload. Caller supplies timestamp + nonce so tests can be
 *  deterministic; wrappers in the API layer generate fresh ones per request. */
export async function signState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64urlEncode(new TextEncoder().encode(payloadJson));
  const signature = await hmacSha256(secret, encodedPayload);
  const encodedSignature = base64urlEncode(signature);
  return `${encodedPayload}.${encodedSignature}`;
}

/** Verify a signed state. Returns the payload on success, null on any
 *  failure (bad shape, tampered signature, expired). */
export async function verifyState(
  state: string,
  secret: string,
  maxAgeMs: number,
  now: number = Date.now(),
): Promise<OAuthStatePayload | null> {
  const dotIndex = state.indexOf('.');
  if (dotIndex < 0 || dotIndex === state.length - 1) return null;
  const encodedPayload = state.slice(0, dotIndex);
  const encodedSignature = state.slice(dotIndex + 1);

  let expectedSignature: Uint8Array;
  try {
    expectedSignature = await hmacSha256(secret, encodedPayload);
  } catch {
    return null;
  }

  let providedSignature: Uint8Array;
  try {
    providedSignature = base64urlDecode(encodedSignature);
  } catch {
    return null;
  }

  if (!constantTimeEqual(expectedSignature, providedSignature)) return null;

  let payload: OAuthStatePayload;
  try {
    const decoded = new TextDecoder().decode(base64urlDecode(encodedPayload));
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const asRecord = parsed as Record<string, unknown>;
    if (
      typeof asRecord.namespace !== 'string' ||
      typeof asRecord.agentId !== 'string' ||
      typeof asRecord.serverName !== 'string' ||
      typeof asRecord.providerId !== 'string' ||
      typeof asRecord.connectedBy !== 'string' ||
      typeof asRecord.ts !== 'number' ||
      typeof asRecord.nonce !== 'string'
    ) {
      return null;
    }
    payload = {
      namespace: asRecord.namespace,
      agentId: asRecord.agentId,
      serverName: asRecord.serverName,
      providerId: asRecord.providerId,
      connectedBy: asRecord.connectedBy,
      ts: asRecord.ts,
      nonce: asRecord.nonce,
      ...(typeof asRecord.codeVerifier === 'string' ? { codeVerifier: asRecord.codeVerifier } : {}),
    };
  } catch {
    return null;
  }

  if (now - payload.ts > maxAgeMs) return null;
  if (payload.ts > now) return null; // Reject future-dated state (clock skew sanity).
  return payload;
}

/** Generate a fresh nonce (16 random bytes, base64url). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

export interface PkcePair {
  /** Random 32-byte value, base64url-encoded. Sent to the token endpoint
   *  as `code_verifier`. Must match the challenge the AS received at
   *  authorize time. */
  codeVerifier: string;
  /** `base64url(SHA-256(codeVerifier))` — sent to the authorize endpoint
   *  as `code_challenge` with `code_challenge_method=S256`. */
  codeChallenge: string;
}

/** Generate a fresh PKCE verifier/challenge pair per RFC 7636. S256 is
 *  the only method we produce; plain is obsolete and several AS reject
 *  it outright (Readwise: `Code challenge required`). */
export async function generatePkcePair(): Promise<PkcePair> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const codeVerifier = base64urlEncode(verifierBytes);
  const digestBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64urlEncode(new Uint8Array(digestBuffer));
  return { codeVerifier, codeChallenge };
}
