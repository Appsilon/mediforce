import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAppBaseUrl, getConfiguredAppBaseUrl, publicOrigin, buildOAuthCallbackUrl } from '../app-base-url';

describe('getConfiguredAppBaseUrl', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('prefers APP_BASE_URL over NEXT_PUBLIC_APP_URL', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://other.example.com';
    expect(getConfiguredAppBaseUrl()).toBe('https://app.example.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.mediforce.ai';
    expect(getConfiguredAppBaseUrl()).toBe('https://staging.mediforce.ai');
  });

  it('treats empty APP_BASE_URL as unset (Docker compose ${VAR:-default} behaviour)', () => {
    process.env.APP_BASE_URL = '';
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.mediforce.ai';
    expect(getConfiguredAppBaseUrl()).toBe('https://staging.mediforce.ai');
  });

  it('returns undefined when neither is set', () => {
    expect(getConfiguredAppBaseUrl()).toBeUndefined();
  });

  it('returns undefined when both are empty strings', () => {
    process.env.APP_BASE_URL = '';
    process.env.NEXT_PUBLIC_APP_URL = '';
    expect(getConfiguredAppBaseUrl()).toBeUndefined();
  });

  it('returns undefined for malformed URLs', () => {
    process.env.APP_BASE_URL = 'not a url';
    expect(getConfiguredAppBaseUrl()).toBeUndefined();
  });

  it('strips path/query — only origin returned', () => {
    process.env.APP_BASE_URL = 'https://app.example.com/some/path?x=1';
    expect(getConfiguredAppBaseUrl()).toBe('https://app.example.com');
  });
});

describe('getAppBaseUrl (with localhost fallback)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses configured URL when env is set', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    expect(getAppBaseUrl()).toBe('https://app.example.com');
  });

  it('falls back to localhost with default port 3000', () => {
    expect(getAppBaseUrl()).toBe('http://localhost:3000');
  });

  it('falls back to localhost with custom PORT', () => {
    process.env.PORT = '9003';
    expect(getAppBaseUrl()).toBe('http://localhost:9003');
  });
});

describe('publicOrigin', () => {
  let originalEnv: NodeJS.ProcessEnv;
  const dockerRequest = new Request('http://e195cf41c355:3000/api/oauth/github/callback');
  const localRequest = new Request('http://localhost:9003/api/oauth/github/callback');

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns env URL when set', () => {
    process.env.APP_BASE_URL = 'https://staging.mediforce.ai';
    expect(publicOrigin(dockerRequest)).toBe('https://staging.mediforce.ai');
  });

  it('falls back to request.url.origin when no env var set', () => {
    expect(publicOrigin(localRequest)).toBe('http://localhost:9003');
  });
});

describe('buildOAuthCallbackUrl', () => {
  let originalEnv: NodeJS.ProcessEnv;
  const request = new Request('http://localhost:9003/any');

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('builds canonical callback URL from env origin', () => {
    process.env.APP_BASE_URL = 'https://staging.mediforce.ai';
    expect(buildOAuthCallbackUrl(request, 'github')).toBe('https://staging.mediforce.ai/api/oauth/github/callback');
  });

  it('encodes provider slug', () => {
    process.env.APP_BASE_URL = 'https://staging.mediforce.ai';
    expect(buildOAuthCallbackUrl(request, 'my provider')).toBe(
      'https://staging.mediforce.ai/api/oauth/my%20provider/callback',
    );
  });
});
