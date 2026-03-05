// packages/platform-ui/src/test/api-routes.test.ts
// RED phase: these tests describe the contracts for Plan 01 integration points.
// They will FAIL before implementation. Run `pnpm test:run` to confirm RED.
// After Task 3 implementation, run again to confirm GREEN.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- validateApiKey contract ---
describe('validateApiKey', () => {
  beforeEach(() => {
    // Reset env before each test
    vi.stubEnv('PLATFORM_API_KEY', 'test-secret-key');
  });

  it('returns true when X-Api-Key header matches PLATFORM_API_KEY env var', async () => {
    // Import after env is set so the module sees the env var
    const { validateApiKey } = await import('../lib/platform-services.js');
    const req = new Request('http://localhost/api/processes', {
      headers: { 'X-Api-Key': 'test-secret-key' },
    });
    expect(validateApiKey(req)).toBe(true);
  });

  it('returns false when X-Api-Key header is wrong', async () => {
    const { validateApiKey } = await import('../lib/platform-services.js');
    const req = new Request('http://localhost/api/processes', {
      headers: { 'X-Api-Key': 'wrong-key' },
    });
    expect(validateApiKey(req)).toBe(false);
  });

  it('returns false when X-Api-Key header is missing', async () => {
    const { validateApiKey } = await import('../lib/platform-services.js');
    const req = new Request('http://localhost/api/processes');
    expect(validateApiKey(req)).toBe(false);
  });
});

