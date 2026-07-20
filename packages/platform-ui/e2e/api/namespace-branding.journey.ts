import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { WORKSPACE_LOGO_MAX_CHARS } from '@mediforce/platform-core';

/**
 * API-level journey for workspace branding (logo + brand colors).
 *
 * Browserless — hits PATCH/GET `/api/namespaces/{handle}` directly so the
 * round-trip covers the storage backend, the route adapter's Zod validation and
 * the auth middleware, none of which the handler unit tests exercise.
 */
test.describe('workspace branding API journey', () => {
  // Locally bootstrap_e2e.py writes `test-api-key`; CI overrides via env.
  const apiKey = process.env.PLATFORM_API_KEY ?? 'test-api-key';
  const authHeaders = { 'X-Api-Key': apiKey };
  const namespaceUrl = `/api/namespaces/${TEST_ORG_HANDLE}`;

  const logoDataUrl =
    'data:image/svg+xml;base64,' +
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>').toString(
      'base64',
    );

  test.afterEach(async ({ request }) => {
    await request.patch(namespaceUrl, {
      headers: authHeaders,
      data: { logo: '', brandPrimaryColor: '', brandAccentColor: '' },
    });
  });

  test('logo and brand colors persist through PATCH → GET', async ({ request }) => {
    const patchRes = await request.patch(namespaceUrl, {
      headers: authHeaders,
      data: {
        logo: logoDataUrl,
        brandPrimaryColor: '#0d9488',
        brandAccentColor: '#f59e0b',
      },
    });
    expect(patchRes.ok(), await patchRes.text()).toBe(true);

    const getRes = await request.get(namespaceUrl, { headers: authHeaders });
    expect(getRes.ok(), await getRes.text()).toBe(true);
    const { namespace } = (await getRes.json()) as {
      namespace: { logo?: string; brandPrimaryColor?: string; brandAccentColor?: string };
    };
    expect(namespace.logo).toBe(logoDataUrl);
    expect(namespace.brandPrimaryColor).toBe('#0d9488');
    expect(namespace.brandAccentColor).toBe('#f59e0b');
  });

  test('empty string clears branding back to the platform default', async ({ request }) => {
    await request.patch(namespaceUrl, {
      headers: authHeaders,
      data: { logo: logoDataUrl, brandPrimaryColor: '#0d9488', brandAccentColor: '#f59e0b' },
    });

    const clearRes = await request.patch(namespaceUrl, {
      headers: authHeaders,
      data: { logo: '', brandPrimaryColor: '', brandAccentColor: '' },
    });
    expect(clearRes.ok(), await clearRes.text()).toBe(true);

    const getRes = await request.get(namespaceUrl, { headers: authHeaders });
    const { namespace } = (await getRes.json()) as {
      namespace: { logo?: string; brandPrimaryColor?: string; brandAccentColor?: string };
    };
    expect(namespace.logo).toBe('');
    expect(namespace.brandPrimaryColor).toBe('');
    expect(namespace.brandAccentColor).toBe('');
  });

  test('rejects a logo over the size cap', async ({ request }) => {
    const oversized = `data:image/png;base64,${'A'.repeat(WORKSPACE_LOGO_MAX_CHARS)}`;

    const res = await request.patch(namespaceUrl, {
      headers: authHeaders,
      data: { logo: oversized },
    });
    expect(res.status(), await res.text()).toBe(400);

    const getRes = await request.get(namespaceUrl, { headers: authHeaders });
    const { namespace } = (await getRes.json()) as { namespace: { logo?: string } };
    expect(namespace.logo ?? '').not.toBe(oversized);
  });

  test('rejects a malformed brand color', async ({ request }) => {
    const res = await request.patch(namespaceUrl, {
      headers: authHeaders,
      data: { brandPrimaryColor: 'teal' },
    });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('rejects an unauthenticated write', async ({ request }) => {
    const res = await request.patch(namespaceUrl, {
      data: { brandPrimaryColor: '#0d9488' },
    });
    expect([401, 403]).toContain(res.status());
  });
});
