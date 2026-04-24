import { describe, it, expect } from 'vitest';
import {
  AgentOAuthTokenSchema,
  PublicAgentOAuthTokenSchema,
} from '../agent-oauth-token.js';

const valid = {
  provider: 'github',
  accessToken: 'ghs_' + 'A'.repeat(40),
  refreshToken: 'ghr_' + 'B'.repeat(40),
  expiresAt: 1_700_000_000_000,
  scope: 'repo read:user',
  providerUserId: '12345',
  accountLogin: '@octocat',
  connectedAt: 1_699_999_000_000,
  connectedBy: 'firebase-uid-abc',
};

describe('AgentOAuthTokenSchema', () => {
  it('parses a full token doc', () => {
    const result = AgentOAuthTokenSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('parses a token without refreshToken or expiresAt (long-lived)', () => {
    const { refreshToken: _rt, expiresAt: _exp, ...rest } = valid;
    const result = AgentOAuthTokenSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshToken).toBeUndefined();
      expect(result.data.expiresAt).toBeUndefined();
    }
  });

  it('rejects empty accessToken', () => {
    const result = AgentOAuthTokenSchema.safeParse({ ...valid, accessToken: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative expiresAt', () => {
    const result = AgentOAuthTokenSchema.safeParse({ ...valid, expiresAt: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects fractional expiresAt (must be integer ms)', () => {
    const result = AgentOAuthTokenSchema.safeParse({ ...valid, expiresAt: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects rogue fields (strict)', () => {
    const result = AgentOAuthTokenSchema.safeParse({ ...valid, oops: true });
    expect(result.success).toBe(false);
  });
});

describe('PublicAgentOAuthTokenSchema', () => {
  it('does not include accessToken or refreshToken in the shape', () => {
    const {
      accessToken: _at,
      refreshToken: _rt,
      ...publicSlice
    } = valid;
    const result = PublicAgentOAuthTokenSchema.safeParse(publicSlice);
    expect(result.success).toBe(true);
  });

  it('rejects a payload that still carries accessToken', () => {
    const result = PublicAgentOAuthTokenSchema.safeParse(valid);
    expect(result.success).toBe(false);
  });
});
