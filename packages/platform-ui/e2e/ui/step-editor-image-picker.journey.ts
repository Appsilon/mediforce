import { execFileSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * L4 UI journey for the step editor's image picker (#1298).
 *
 * The claim under test is one nothing but a real probe can make: an image
 * carrying no agent CLI is *not offered* to an agent step, which is the fix for
 * the `exec: "claude": executable file not found` class of run-time failure. So
 * this journey builds two real images that differ only in what is on their
 * PATH, catalogues both, and asserts what an author is allowed to click.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

const BASE_IMAGE = 'alpine:3.22';
const DEFINITION_URL = `/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`;

function docker(...args: string[]): void {
  execFileSync('docker', args, { stdio: 'pipe' });
}

function dockerAvailable(): boolean {
  try {
    docker('info');
    return true;
  } catch {
    return false;
  }
}

/**
 * `docker commit` rather than `docker build`: one real layer in about a second.
 *
 * The probe answers `command -v`, so an executable named `claude` on PATH is
 * exactly the fact it reads — no network, no package manager, and no agent CLI
 * actually installed in an E2E image.
 */
function commitImage(tag: string, script: string): void {
  const container = `mediforce-e2e-picker-${tag.replace(/[^a-z0-9]/gi, '-')}`;
  docker('run', '--name', container, BASE_IMAGE, 'sh', '-c', script);
  try {
    docker('commit', container, tag);
  } finally {
    docker('rm', '-f', container);
  }
}

async function catalogue(
  request: APIRequestContext,
  name: string,
  intent: string,
  reference: string,
): Promise<string> {
  const res = await request.post(`/api/image-catalog?namespace=${TEST_ORG_HANDLE}`, {
    headers: AUTH,
    data: { name, intent, source: { kind: 'referenced', reference } },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { entry: { id: string } }).entry.id;
}

test.describe('Step editor image picker journey', () => {
  test.skip(!dockerAvailable(), 'Docker daemon not available');

  test('an agent step is offered only images a probe says can run one', async ({ page, request }) => {
    // Registering an entry probes its image in a container, and every catalog
    // read shells out to Docker. The default 30 s is a timing assertion nobody
    // meant to write.
    test.setTimeout(180_000);
    trackPageErrors(page);

    const stamp = Date.now();
    const capableReference = `mediforce-e2e-picker-capable-${stamp}`;
    const barrenReference = `mediforce-e2e-picker-barren-${stamp}`;
    const capableIntent = `Runs agents over ADaM datasets ${stamp}`;
    const barrenIntent = `A minimal base with no agent CLI ${stamp}`;
    const entryIds: string[] = [];

    try {
      docker('image', 'inspect', BASE_IMAGE);
    } catch {
      docker('pull', BASE_IMAGE);
    }
    commitImage(
      `${capableReference}:v1`,
      'printf "#!/bin/sh\\nexit 0\\n" > /usr/local/bin/claude'
      + ' && printf "#!/bin/sh\\nexit 0\\n" > /usr/local/bin/bash'
      + ' && chmod +x /usr/local/bin/claude /usr/local/bin/bash',
    );
    commitImage(`${barrenReference}:v1`, 'mkdir /e2e-barren-marker');

    try {
      entryIds.push(await catalogue(request, `E2E capable ${stamp}`, capableIntent, capableReference));
      entryIds.push(await catalogue(request, `E2E barren ${stamp}`, barrenIntent, barrenReference));

      await page.goto(DEFINITION_URL);
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 });
      const initialNodeCount = await page.locator('.react-flow__node').count();

      await page.getByLabel('Add step here').first().click();
      await expect(page.getByTestId('picker-tier-simple')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('picker-tier-full').click();
      const agentSection = page.getByTestId('section-agent');
      if (await agentSection.getAttribute('data-open') !== 'true') {
        await agentSection.getByRole('button').first().click();
      }
      await page.getByTestId('executor-option-autonomous-agent').click();
      await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 10_000 });

      await page.locator('.react-flow__node').filter({ hasText: /New Step/i }).click();
      const stepEditor = page.locator('[data-testid="step-editor"]');
      await expect(stepEditor).toBeVisible({ timeout: 10_000 });
      await stepEditor.getByRole('button', { name: 'Prompt & model' }).click();

      const picker = stepEditor.getByRole('combobox', { name: 'Known Docker image' });
      // The catalog read is polled, so the option arrives after the first render.
      await expect(picker.locator('option', { hasText: capableIntent })).toHaveCount(1, {
        timeout: 60_000,
      });
      // The image with no agent CLI is not a click away from an agent step.
      await expect(picker.locator('option', { hasText: barrenIntent })).toHaveCount(0);

      await picker.selectOption(`${capableReference}:v1`);
      await expect(picker).toHaveValue(`${capableReference}:v1`);

      // The picked value round-trips into the definition the editor would save.
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      await page.getByRole('button', { name: /workflow source code/i }).click();
      const scroller = page.locator('div.overflow-y-auto').filter({ has: page.locator('.cm-editor') });
      await expect(async () => {
        await scroller.evaluate((el) => { el.scrollTop += 400; });
        await expect(page.locator('.cm-content')).toContainText(`${capableReference}:v1`, {
          timeout: 1_000,
        });
      }).toPass({ timeout: 15_000 });
    } finally {
      for (const id of entryIds) {
        await request.delete(`/api/image-catalog/${id}?namespace=${TEST_ORG_HANDLE}`, { headers: AUTH });
      }
      docker('rmi', `${capableReference}:v1`, `${barrenReference}:v1`);
    }
  });
});
