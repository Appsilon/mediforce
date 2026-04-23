import { describe, it, expect } from 'vitest';
import { signState, verifyState, generateNonce, type OAuthStatePayload } from '../state-hmac.js';

const SECRET = 'test-hmac-secret-0123456789';

function fixture(overrides: Partial<OAuthStatePayload> = {}): OAuthStatePayload {
  return {
    namespace: 'acme',
    agentId: 'claude-code-agent',
    serverName: 'github',
    providerId: 'github',
    ts: 1_700_000_000_000,
    nonce: 'test-nonce-abc',
    ...overrides,
  };
}

describe('signState + verifyState', () => {
  it('round-trips a valid payload', async () => {
    const payload = fixture();
    const state = await signState(payload, SECRET);
    const verified = await verifyState(state, SECRET, 10 * 60_000, payload.ts + 5_000);
    expect(verified).toEqual(payload);
  });

  it('rejects a state signed with a different secret', async () => {
    const state = await signState(fixture(), SECRET);
    const verified = await verifyState(state, 'different-secret', 10 * 60_000, fixture().ts + 5_000);
    expect(verified).toBeNull();
  });

  it('rejects a tampered payload (same signature, mutated body)', async () => {
    const state = await signState(fixture(), SECRET);
    const [encoded, signature] = state.split('.');
    const tamperedBody = encoded.slice(0, -2) + 'xx';
    const tampered = `${tamperedBody}.${signature}`;
    const verified = await verifyState(tampered, SECRET, 10 * 60_000, fixture().ts + 5_000);
    expect(verified).toBeNull();
  });

  it('rejects a state past its TTL', async () => {
    const payload = fixture({ ts: 1_700_000_000_000 });
    const state = await signState(payload, SECRET);
    const verified = await verifyState(state, SECRET, 60_000, payload.ts + 120_000);
    expect(verified).toBeNull();
  });

  it('rejects a state with a future ts (clock skew sanity)', async () => {
    const payload = fixture({ ts: 1_700_000_060_000 });
    const state = await signState(payload, SECRET);
    const verified = await verifyState(state, SECRET, 10 * 60_000, payload.ts - 60_000);
    expect(verified).toBeNull();
  });

  it('rejects malformed state (no dot)', async () => {
    const verified = await verifyState('just-one-chunk', SECRET, 10 * 60_000);
    expect(verified).toBeNull();
  });

  it('rejects state with empty signature segment', async () => {
    const verified = await verifyState('body.', SECRET, 10 * 60_000);
    expect(verified).toBeNull();
  });

  it('rejects state whose decoded payload fails shape checks', async () => {
    // Craft a valid signature over a payload that is missing required fields.
    const bogusPayload = JSON.stringify({ namespace: 'acme' });
    const encoded = Buffer.from(bogusPayload, 'utf-8').toString('base64url');
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', SECRET)
      .update(encoded)
      .digest('base64url');
    const crafted = `${encoded}.${sig}`;
    const verified = await verifyState(crafted, SECRET, 10 * 60_000, 1_700_000_000_000);
    expect(verified).toBeNull();
  });
});

describe('generateNonce', () => {
  it('returns a string of non-trivial length', () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(20);
  });

  it('returns distinct values on successive calls', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });

  it('uses only base64url-safe characters', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
