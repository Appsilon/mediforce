import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { seedOutputFiles } from '../helpers/seed-output-files';

/**
 * API E2E for Output Files: list (`GET /api/runs/<runId>/files`), download one
 * (`GET /api/runs/<runId>/files/<path>`), and download all as a zip
 * (`GET /api/runs/<runId>/files/archive`).
 *
 * The run itself is driven end-to-end through the platform (agent step under
 * MOCK_AGENT=true), but the Output Files are SEEDED into the bare repo with
 * git directly (see `seedOutputFiles`) because the mock path never commits
 * under `.mediforce/output/<stepId>/`.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY };

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  {
    timeoutMs = 20_000,
    intervalMs = 250,
    description = 'condition',
  }: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== null) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`);
}

interface OutputFileEntry {
  stepId: string;
  name: string;
  path: string;
  size: number;
}

test.describe('Run Output Files — API E2E', () => {
  const wdName = `e2e-output-files-${Date.now()}`;

  const csvContent = 'study,grade\nS-001,2\n';
  const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  // Every byte value 0–255 — proves non-utf8 bytes survive the round-trip.
  const binaryContent = Buffer.from(Array.from({ length: 256 }, (_, byteValue) => byteValue));

  async function registerWorkflowDefinition(request: APIRequestContext): Promise<void> {
    const wd = {
      name: wdName,
      title: 'E2E Output Files',
      steps: [
        {
          id: 'generate',
          name: 'Generate artifacts',
          type: 'creation',
          executor: 'agent',
          autonomyLevel: 'L2',
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'generate', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const createWdRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      { headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' }, data: wd },
    );
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);
  }

  async function startRunAndAwaitTerminal(request: APIRequestContext): Promise<string> {
    const triggerRes = await request.post('/api/processes', {
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      data: {
        namespace: TEST_ORG_HANDLE,
        definitionName: wdName,
        triggeredBy: 'e2e-test',
        triggerName: 'Start',
      },
    });
    expect(triggerRes.status(), await triggerRes.text()).toBe(201);
    const { run } = (await triggerRes.json()) as { run: { id: string } };

    await pollUntil(
      async () => {
        const res = await request.get(`/api/runs/${run.id}`, { headers: AUTH_HEADERS });
        if (res.status() !== 200) return null;
        const body = (await res.json()) as { status: string };
        return body.status === 'completed' || body.status === 'failed' ? body : null;
      },
      { description: `run ${run.id} to reach a terminal status` },
    );
    return run.id;
  }

  test('lists, downloads, and guards Output Files across the run lifecycle', async ({ request }) => {
    await registerWorkflowDefinition(request);
    const runId = await startRunAndAwaitTerminal(request);

    // -------- A run with no Output Files lists as empty, 200 --------
    const emptyListRes = await request.get(`/api/runs/${runId}/files`, { headers: AUTH_HEADERS });
    expect(emptyListRes.status(), await emptyListRes.text()).toBe(200);
    expect(await emptyListRes.json()).toEqual({ files: [] });

    // -------- Seed the git side for this runId (see module doc) --------
    await seedOutputFiles(wdName, runId, {
      generate: {
        'report.csv': csvContent,
        'charts/plot.svg': svgContent,
        'data.bin': binaryContent,
      },
    });

    // -------- List --------
    const listRes = await request.get(`/api/runs/${runId}/files`, { headers: AUTH_HEADERS });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const { files } = (await listRes.json()) as { files: OutputFileEntry[] };
    const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
    expect(sorted).toEqual([
      {
        stepId: 'generate',
        name: 'charts/plot.svg',
        path: '.mediforce/output/generate/charts/plot.svg',
        size: Buffer.byteLength(svgContent),
      },
      {
        stepId: 'generate',
        name: 'data.bin',
        path: '.mediforce/output/generate/data.bin',
        size: binaryContent.byteLength,
      },
      {
        stepId: 'generate',
        name: 'report.csv',
        path: '.mediforce/output/generate/report.csv',
        size: Buffer.byteLength(csvContent),
      },
    ]);

    // -------- Download: text + nested + binary byte-identity --------
    const csvRes = await request.get(`/api/runs/${runId}/files/.mediforce/output/generate/report.csv`, {
      headers: AUTH_HEADERS,
    });
    expect(csvRes.status(), await csvRes.text()).toBe(200);
    expect((await csvRes.body()).toString('utf-8')).toBe(csvContent);
    expect(csvRes.headers()['content-type']).toBe('text/csv; charset=utf-8');
    expect(csvRes.headers()['content-disposition']).toBe(
      `attachment; filename="report.csv"; filename*=UTF-8''report.csv`,
    );

    const svgRes = await request.get(
      `/api/runs/${runId}/files/.mediforce/output/generate/charts/plot.svg`,
      { headers: AUTH_HEADERS },
    );
    expect(svgRes.status()).toBe(200);
    expect((await svgRes.body()).toString('utf-8')).toBe(svgContent);
    expect(svgRes.headers()['content-type']).toBe('image/svg+xml');

    const binRes = await request.get(`/api/runs/${runId}/files/.mediforce/output/generate/data.bin`, {
      headers: AUTH_HEADERS,
    });
    expect(binRes.status()).toBe(200);
    expect((await binRes.body()).equals(binaryContent)).toBe(true);
    expect(binRes.headers()['content-type']).toBe('application/octet-stream');

    // -------- Download all as one zip archive --------
    const archiveRes = await request.get(`/api/runs/${runId}/files/archive`, { headers: AUTH_HEADERS });
    expect(archiveRes.status(), await archiveRes.text()).toBe(200);
    expect(archiveRes.headers()['content-type']).toBe('application/zip');
    expect(archiveRes.headers()['content-disposition']).toBe(
      `attachment; filename="${wdName}-${runId.slice(0, 8)}-output.zip"; ` +
        `filename*=UTF-8''${wdName}-${runId.slice(0, 8)}-output.zip`,
    );
    // Zip local-file-header magic — proves a real archive, not an error body.
    const archiveBody = await archiveRes.body();
    expect(archiveBody.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(archiveBody.byteLength).toBeGreaterThan(0);

    // -------- Missing file under the output root → 404, not bytes --------
    const ghostRes = await request.get(`/api/runs/${runId}/files/.mediforce/output/generate/ghost.txt`, {
      headers: AUTH_HEADERS,
    });
    expect(ghostRes.status()).toBe(404);

    // -------- Path traversal / outside-root → rejected, never file content --------
    // `..` percent-encoded so the HTTP layer can't normalize it away before
    // the route sees it. Accept any 4xx rejection; assert no leak either way.
    const traversalRes = await request.get(
      `/api/runs/${runId}/files/.mediforce/output/%2E%2E/%2E%2E/secret`,
      { headers: AUTH_HEADERS },
    );
    expect(traversalRes.status()).toBeGreaterThanOrEqual(400);
    expect(traversalRes.status()).toBeLessThan(500);
    expect(await traversalRes.text()).not.toContain('study,grade');

    const outsideRootRes = await request.get(`/api/runs/${runId}/files/etc/passwd`, {
      headers: AUTH_HEADERS,
    });
    expect(outsideRootRes.status()).toBe(400);
    expect(await outsideRootRes.text()).not.toContain('root:');

    // -------- Listing a missing run → 404 (anti-enumeration) --------
    const missingRunRes = await request.get('/api/runs/no-such-run/files', { headers: AUTH_HEADERS });
    expect(missingRunRes.status()).toBe(404);

    // -------- Archiving a missing / out-of-scope run → 404 (anti-enumeration) --------
    const missingArchiveRes = await request.get('/api/runs/no-such-run/files/archive', {
      headers: AUTH_HEADERS,
    });
    expect(missingArchiveRes.status()).toBe(404);
  });

  test('rejects unauthenticated access to all routes with 401', async ({ request }) => {
    const listRes = await request.get('/api/runs/any-run/files');
    expect(listRes.status()).toBe(401);

    const downloadRes = await request.get('/api/runs/any-run/files/.mediforce/output/step/file.txt');
    expect(downloadRes.status()).toBe(401);

    const archiveRes = await request.get('/api/runs/any-run/files/archive');
    expect(archiveRes.status()).toBe(401);
  });
});
