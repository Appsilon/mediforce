import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

/** Read PLATFORM_API_KEY from the dev server's `.env.local` so the test stays in sync
 *  with whatever the running webServer is using — bootstrap_e2e.py is idempotent and
 *  preserves an existing key, so falling back to a hard-coded `test-api-key` would 401. */
function resolveApiKey(): string {
  const fromEnv = process.env.PLATFORM_API_KEY;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  try {
    const envPath = path.resolve(__dirname, '..', '..', '.env.local');
    const raw = fs.readFileSync(envPath, 'utf8');
    const match = raw.match(/^PLATFORM_API_KEY=(.*)$/m);
    if (match && match[1]) return match[1].trim();
  } catch { /* fall through */ }
  return 'test-api-key';
}

/**
 * UI journey for the Repository tab on the workflow detail page.
 *
 * Verifies the click-through edit path: Repository tab → fill Remote → Save →
 * a new WD version is written with the workspace config persisted in Firestore.
 *
 * Asserts persistence via the platform API (X-Api-Key) — the same source of truth
 * the runtime reads at run start.
 */
test.describe('Workflow Repository UI journey', () => {
  const apiKey = resolveApiKey();
  const authHeaders = { 'X-Api-Key': apiKey };

  test('Repository tab persists workspace.remote as a new WD version', async ({ page, request }, testInfo) => {
    await setupRecording(page, 'workflow-repository-ui', testInfo);

    // 1. Seed a fresh WD without workspace via the API
    const uniqueName = `ui-repository-${Date.now()}`;
    const seedRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: authHeaders,
        data: {
          name: uniqueName,
          description: 'UI journey test — repository tab',
          steps: [
            { id: 'noop', name: 'No-op', type: 'creation', executor: 'human' },
          ],
          transitions: [],
          triggers: [{ type: 'manual', name: 'start' }],
        },
      },
    );
    expect(seedRes.status(), await seedRes.text()).toBe(201);
    const seeded = await seedRes.json();
    expect(seeded.version).toBe(1);

    // 2. Navigate to the workflow detail page and switch to Repository tab
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(uniqueName)}`);

    const repositoryTab = page.getByRole('tab', { name: /repository/i });
    await expect(repositoryTab).toBeVisible({ timeout: 10_000 });
    await click(page, repositoryTab);
    await showStep(page);

    // 3. Fill the Remote field
    const remoteInput = page.getByLabel(/^remote$/i);
    await expect(remoteInput).toBeVisible({ timeout: 5_000 });
    const expectedRemote = 'Appsilon/repo-from-ui-journey';
    await remoteInput.fill(expectedRemote);
    await showStep(page);

    // 4. Save → button is enabled while dirty + valid
    const saveButton = page.getByRole('button', { name: /save \(new version\)/i });
    await expect(saveButton).toBeEnabled();
    await click(page, saveButton);

    // 5. Success message confirms a new version was written
    await expect(page.getByText(/saved as version 2/i)).toBeVisible({ timeout: 10_000 });
    await showResult(page);

    // 6. Verify Firestore (via API) — listing returns the latest version per WD
    const listRes = await request.get('/api/workflow-definitions', { headers: authHeaders });
    expect(listRes.ok(), await listRes.text()).toBe(true);
    const list = (await listRes.json()) as {
      definitions: Array<{
        name: string;
        latestVersion: number;
        defaultVersion?: number | null;
        definition: { workspace?: unknown } | null;
      }>;
    };
    const entry = list.definitions.find((d) => d.name === uniqueName);
    expect(entry, `WD ${uniqueName} should be in the list`).toBeDefined();
    expect(entry!.latestVersion).toBe(2);
    expect(entry!.defaultVersion).toBe(2);
    expect(entry!.definition).not.toBeNull();
    expect(entry!.definition!.workspace).toEqual({ remote: expectedRemote });

    await endRecording(page);
  });
});
