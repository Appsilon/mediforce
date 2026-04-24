import { describe, it, expect } from 'vitest';
import {
  OAuthProviderConfigSchema,
  PublicOAuthProviderConfigSchema,
  CreateOAuthProviderInputSchema,
  UpdateOAuthProviderInputSchema,
  OAUTH_PROVIDER_PRESETS,
} from '../oauth-provider.js';

const validInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'Iv1.1234567890abcdef',
  clientSecret: 'supersecret',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo', 'read:user'],
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
};

describe('OAuthProviderConfigSchema', () => {
  it('parses a full valid config', () => {
    const result = OAuthProviderConfigSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('parses with optional revokeUrl + iconUrl', () => {
    const result = OAuthProviderConfigSchema.safeParse({
      ...validInput,
      revokeUrl: 'https://example.com/revoke',
      iconUrl: 'https://example.com/icon.svg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects id with uppercase', () => {
    const result = OAuthProviderConfigSchema.safeParse({ ...validInput, id: 'GitHub' });
    expect(result.success).toBe(false);
  });

  it('rejects id starting with dash', () => {
    const result = OAuthProviderConfigSchema.safeParse({ ...validInput, id: '-github' });
    expect(result.success).toBe(false);
  });

  it('rejects empty scopes array', () => {
    const result = OAuthProviderConfigSchema.safeParse({ ...validInput, scopes: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty clientSecret', () => {
    const result = OAuthProviderConfigSchema.safeParse({ ...validInput, clientSecret: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid authorizeUrl', () => {
    const result = OAuthProviderConfigSchema.safeParse({ ...validInput, authorizeUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    const result = OAuthProviderConfigSchema.safeParse({ ...validInput, allowEvil: true });
    expect(result.success).toBe(false);
  });
});

describe('PublicOAuthProviderConfigSchema', () => {
  it('omits clientSecret', () => {
    const { clientSecret: _discard, ...publicInput } = validInput;
    const result = PublicOAuthProviderConfigSchema.safeParse(publicInput);
    expect(result.success).toBe(true);
    if (result.success) {
      // @ts-expect-error — clientSecret removed from schema
      expect(result.data.clientSecret).toBeUndefined();
    }
  });

  it('rejects clientSecret if present on the public slice', () => {
    const result = PublicOAuthProviderConfigSchema.safeParse(validInput);
    // Because PublicOAuthProviderConfigSchema omits clientSecret and parent
    // is `.strict()`, a payload with clientSecret is rejected at the
    // public surface.
    expect(result.success).toBe(false);
  });
});

describe('CreateOAuthProviderInputSchema', () => {
  it('omits createdAt + updatedAt (server-managed)', () => {
    const { createdAt: _c, updatedAt: _u, ...createInput } = validInput;
    const result = CreateOAuthProviderInputSchema.safeParse(createInput);
    expect(result.success).toBe(true);
  });
});

describe('UpdateOAuthProviderInputSchema', () => {
  it('accepts partial updates — just name', () => {
    const result = UpdateOAuthProviderInputSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts empty partial update', () => {
    const result = UpdateOAuthProviderInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects id override (id comes from URL)', () => {
    const result = UpdateOAuthProviderInputSchema.safeParse({ id: 'rename' });
    expect(result.success).toBe(false);
  });

  it('validates updated scopes still have at least one entry', () => {
    const result = UpdateOAuthProviderInputSchema.safeParse({ scopes: [] });
    expect(result.success).toBe(false);
  });
});

describe('OAUTH_PROVIDER_PRESETS', () => {
  it('github preset has the canonical endpoints', () => {
    expect(OAUTH_PROVIDER_PRESETS.github.authorizeUrl).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(OAUTH_PROVIDER_PRESETS.github.scopes).toContain('repo');
  });

  it('google preset has the token + revoke endpoints', () => {
    expect(OAUTH_PROVIDER_PRESETS.google.tokenUrl).toBe(
      'https://oauth2.googleapis.com/token',
    );
    expect(OAUTH_PROVIDER_PRESETS.google.revokeUrl).toBe(
      'https://oauth2.googleapis.com/revoke',
    );
  });

  it('presets pass Create schema when credentials are filled in', () => {
    for (const preset of Object.values(OAUTH_PROVIDER_PRESETS)) {
      const result = CreateOAuthProviderInputSchema.safeParse({
        ...preset,
        clientId: 'dummy-client',
        clientSecret: 'dummy-secret',
      });
      expect(result.success).toBe(true);
    }
  });
});
