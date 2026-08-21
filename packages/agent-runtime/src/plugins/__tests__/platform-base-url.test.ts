import { describe, it, expect, afterEach } from 'vitest';
import { platformBaseUrl } from '../base-container-agent-plugin';

// Regression: attachment downloads (and the run-kicker) resolve relative
// `/api/attachments/:id/blob` URLs against this base. dev:mock / e2e set only
// NEXT_PUBLIC_APP_URL (:9007); without the fallback the base was a dead
// localhost:9003, so every agent step reading an uploaded file died "fetch failed".

describe('platformBaseUrl', () => {
  const saved = { app: process.env.APP_BASE_URL, pub: process.env.NEXT_PUBLIC_APP_URL };
  afterEach(() => {
    if (saved.app === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved.app;
    if (saved.pub === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = saved.pub;
  });

  it('prefers APP_BASE_URL when set', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:9007';
    expect(platformBaseUrl()).toBe('https://app.example.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL when APP_BASE_URL is unset (the dev:mock case)', () => {
    delete process.env.APP_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:9007';
    expect(platformBaseUrl()).toBe('http://localhost:9007');
  });

  it('treats an empty-string APP_BASE_URL as unset', () => {
    process.env.APP_BASE_URL = '';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:9007';
    expect(platformBaseUrl()).toBe('http://localhost:9007');
  });

  it('falls back to localhost when neither is set', () => {
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(platformBaseUrl()).toBe('http://localhost:9003');
  });
});
