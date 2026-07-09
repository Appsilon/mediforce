import { describe, it, expect } from 'vitest';
import { toPublicProvider } from '../_helpers';

describe('toPublicProvider', () => {
  const fullProvider = {
    id: 'github',
    name: 'GitHub',
    clientId: 'client-id-xyz',
    clientSecret: 'client-secret-xyz',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user'],
    createdAt: '2026-04-23T00:00:00.000Z',
    updatedAt: '2026-04-23T00:00:00.000Z',
  };

  it('strips clientSecret', () => {
    const result = toPublicProvider(fullProvider);

    expect(result).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(result)).not.toContain('client-secret-xyz');
  });

  it('preserves all other fields', () => {
    const result = toPublicProvider(fullProvider);

    expect(result.id).toBe('github');
    expect(result.name).toBe('GitHub');
    expect(result.scopes).toEqual(['repo', 'read:user']);
    expect(result.tokenUrl).toBe('https://github.com/login/oauth/access_token');
  });
});
