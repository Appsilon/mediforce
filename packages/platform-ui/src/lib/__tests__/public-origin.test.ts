import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publicOrigin } from '../public-origin';

const REQUEST_FROM_DOCKER_HOSTNAME = new Request(
  'http://e195cf41c355:3000/api/oauth/github/callback',
);
const REQUEST_FROM_LOCALHOST = new Request(
  'http://localhost:9003/api/oauth/github/callback',
);

describe('publicOrigin', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('prefers APP_BASE_URL over the request URL', () => {
    process.env.APP_BASE_URL = 'https://staging.mediforce.ai';
    expect(publicOrigin(REQUEST_FROM_DOCKER_HOSTNAME)).toBe('https://staging.mediforce.ai');
  });

  it('falls back to NEXT_PUBLIC_APP_URL when APP_BASE_URL is unset', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.mediforce.ai';
    expect(publicOrigin(REQUEST_FROM_DOCKER_HOSTNAME)).toBe('https://staging.mediforce.ai');
  });

  it('APP_BASE_URL wins when both env vars are set', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://other.example.com';
    expect(publicOrigin(REQUEST_FROM_LOCALHOST)).toBe('https://app.example.com');
  });

  it('strips path/query from the env URL — only origin is returned', () => {
    process.env.APP_BASE_URL = 'https://staging.mediforce.ai/some/path?query=1';
    expect(publicOrigin(REQUEST_FROM_DOCKER_HOSTNAME)).toBe('https://staging.mediforce.ai');
  });

  it('falls back to request URL origin when no env var is set (local dev)', () => {
    expect(publicOrigin(REQUEST_FROM_LOCALHOST)).toBe('http://localhost:9003');
  });

  it('falls back to request URL origin when env var is empty string', () => {
    process.env.APP_BASE_URL = '';
    process.env.NEXT_PUBLIC_APP_URL = '';
    expect(publicOrigin(REQUEST_FROM_LOCALHOST)).toBe('http://localhost:9003');
  });

  it('treats empty APP_BASE_URL as unset and falls through to NEXT_PUBLIC_APP_URL', () => {
    // Docker compose's ${VAR:-fallback} can leave APP_BASE_URL="" in the
    // environment — `||` (not `??`) handles that correctly.
    process.env.APP_BASE_URL = '';
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.mediforce.ai';
    expect(publicOrigin(REQUEST_FROM_DOCKER_HOSTNAME)).toBe('https://staging.mediforce.ai');
  });

  it('falls back gracefully when env var is not a valid URL', () => {
    process.env.APP_BASE_URL = 'not a url';
    expect(publicOrigin(REQUEST_FROM_LOCALHOST)).toBe('http://localhost:9003');
  });
});
