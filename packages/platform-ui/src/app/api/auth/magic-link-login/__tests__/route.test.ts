import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockIsEmailDeliveryConfigured = vi.fn<() => boolean>();

vi.mock('@mediforce/platform-infra', () => ({
  isEmailDeliveryConfigured: () => mockIsEmailDeliveryConfigured(),
}));

import { GET } from '../route';

/**
 * The magic-link-login route carries the login page's email-related display
 * flags. `enabled` must NOT reflect whether the Email provider is registered
 * (that follows email configuration, to keep invite links working with login
 * magic-link off) — only `ENABLE_MAGIC_LINK`. `emailDeliveryEnabled` is the
 * separate signal the "Resend setup link" recovery gates on.
 */
describe('/api/auth/magic-link-login', () => {
  beforeEach(() => {
    delete process.env.ENABLE_MAGIC_LINK;
    mockIsEmailDeliveryConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.ENABLE_MAGIC_LINK;
  });

  it('reports enabled: true when ENABLE_MAGIC_LINK is "true"', async () => {
    process.env.ENABLE_MAGIC_LINK = 'true';
    expect(await (await GET()).json()).toEqual({ enabled: true, emailDeliveryEnabled: true });
  });

  it('reports enabled: false when ENABLE_MAGIC_LINK is unset', async () => {
    expect(await (await GET()).json()).toEqual({ enabled: false, emailDeliveryEnabled: true });
  });

  it('reports enabled: false when ENABLE_MAGIC_LINK is any non-"true" value', async () => {
    process.env.ENABLE_MAGIC_LINK = 'false';
    expect(await (await GET()).json()).toEqual({ enabled: false, emailDeliveryEnabled: true });
  });

  // A Google-only deployment with email configured offers no magic-link, yet
  // still delivers setup links — the recovery must stay reachable there (#1109).
  it('reports emailDeliveryEnabled independently of the magic-link display flag', async () => {
    mockIsEmailDeliveryConfigured.mockReturnValue(false);
    expect(await (await GET()).json()).toEqual({ enabled: false, emailDeliveryEnabled: false });

    process.env.ENABLE_MAGIC_LINK = 'true';
    expect(await (await GET()).json()).toEqual({ enabled: true, emailDeliveryEnabled: false });
  });
});
