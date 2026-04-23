import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from './helpers/constants';

test.describe('Smoke Tests', () => {
  test('login page loads and shows sign-in button', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/mediforce/i);
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await page.waitForURL('**/login**');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('API auth smoke', () => {
  test('GET /api/health without X-Api-Key returns 200', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
  });

  test('GET /api/workflow-definitions without X-Api-Key returns 401', async ({ request }) => {
    const res = await request.get('/api/workflow-definitions');
    expect(res.status()).toBe(401);
  });

  test('POST /api/agent-definitions without X-Api-Key returns 401', async ({ request }) => {
    // Pre-Step-0 this route had no auth check — middleware closes that gap.
    const res = await request.post('/api/agent-definitions', { data: {} });
    expect(res.status()).toBe(401);
  });
});
