import type { CreateOAuthProviderInput } from '@mediforce/platform-core';

export const sampleProviderInput: CreateOAuthProviderInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'client-id-xyz',
  clientSecret: 'client-secret-xyz',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo', 'read:user'],
};

export const adminRoles = new Map<string, 'owner' | 'admin' | 'member'>([['alpha', 'admin']]);

export const ownerRoles = new Map<string, 'owner' | 'admin' | 'member'>([['alpha', 'owner']]);

export const memberRoles = new Map<string, 'owner' | 'admin' | 'member'>([['alpha', 'member']]);
