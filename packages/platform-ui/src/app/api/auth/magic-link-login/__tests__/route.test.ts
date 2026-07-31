import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { GET } from '../route';

/**
 * The magic-link-login route is a pure display flag: it reports whether the
 * login page should reveal "Email me a sign-in link". It must NOT reflect
 * whether the Email provider is registered (that follows email configuration,
 * to keep invite links working with login magic-link off) — only
 * `ENABLE_MAGIC_LINK`.
 */
describe('/api/auth/magic-link-login', () => {
  beforeEach(() => {
    delete process.env.ENABLE_MAGIC_LINK;
  });

  afterEach(() => {
    delete process.env.ENABLE_MAGIC_LINK;
  });

  it('reports enabled: true when ENABLE_MAGIC_LINK is "true"', async () => {
    process.env.ENABLE_MAGIC_LINK = 'true';
    expect(await (await GET()).json()).toEqual({ enabled: true });
  });

  it('reports enabled: false when ENABLE_MAGIC_LINK is unset', async () => {
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });

  it('reports enabled: false when ENABLE_MAGIC_LINK is any non-"true" value', async () => {
    process.env.ENABLE_MAGIC_LINK = 'false';
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });
});
