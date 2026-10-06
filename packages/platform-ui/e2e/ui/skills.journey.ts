import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { allowPageErrors, trackPageErrors } from '../helpers/page-errors';

/**
 * Skills catalog UI (#1463, ADR-0025): a member creates a skill in the editor,
 * edits it, uploads a skill folder, and is told by name which agent blocks a
 * delete. Every skill and agent is created for its test alone.
 */

const skillMd = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

/** Replace the open file's contents. CodeMirror is a contenteditable, so the
 *  text goes in as one input event rather than keystroke by keystroke. */
async function replaceEditorText(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('skill-file-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

const deleteSkill = (page: Page, id: string) => page.request.delete(`/api/skills/${id}?namespace=${TEST_ORG_HANDLE}`);

test.describe('Skills Catalog Journey', () => {
  test('create a skill with a references file, find it in the list, edit it, and keep the edit after reload', async ({ page }) => {
    test.setTimeout(90_000);
    trackPageErrors(page);
    const id = `e2e-ui-editor-${Date.now()}`;

    try {
      await page.goto(`/${TEST_ORG_HANDLE}/skills/new`);
      // A new skill starts from the template SKILL.md.
      await expect(page.getByTestId('skill-manifest')).toContainText('my-skill', { timeout: 30_000 });

      await replaceEditorText(page, skillMd(id, 'Grade adverse events by CTCAE'));
      // Name and description are read live from the frontmatter.
      await expect(page.getByTestId('skill-manifest')).toContainText(id);
      await expect(page.getByTestId('skill-manifest')).toContainText('Grade adverse events by CTCAE');

      await page.getByRole('button', { name: 'Add file' }).click();
      await page.getByLabel('New file path').fill('references/ctcae.md');
      await page.getByLabel('New file path').press('Enter');
      await replaceEditorText(page, 'Grade 5 = death\n');

      await page.getByRole('button', { name: 'Create skill' }).click();
      await expect(page).toHaveURL(new RegExp(`/skills/${TEST_ORG_HANDLE}/${id}$`), { timeout: 15_000 });

      await page.goto(`/${TEST_ORG_HANDLE}/skills`);
      const card = page.getByTestId('skill-card').filter({ hasText: id });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText('2 files');
      await card.getByRole('link', { name: new RegExp(id) }).click();

      await page.getByRole('button', { name: 'ctcae.md', exact: true }).click();
      await replaceEditorText(page, 'Grade 4 = life-threatening\nGrade 5 = death\n');
      const saved = page.waitForResponse((res) => res.url().includes(`/api/skills/${id}`) && res.request().method() === 'PATCH');
      await page.getByRole('button', { name: 'Save changes' }).click();
      expect((await saved).status()).toBe(200);

      await page.reload();
      await page.getByRole('button', { name: 'ctcae.md', exact: true }).click({ timeout: 30_000 });
      await expect(page.getByTestId('skill-file-editor').locator('.cm-content')).toContainText('Grade 4 = life-threatening');
    } finally {
      await deleteSkill(page, id);
    }
  });

  test('upload a skill folder: the wrapping folder is stripped, binaries are skipped by name, every text file is saved', async ({ page }) => {
    test.setTimeout(60_000);
    trackPageErrors(page);
    const id = `e2e-ui-upload-${Date.now()}`;
    // Laid out as a Claude Code `skills/<name>/` folder, picked by its own name.
    const folder = join(mkdtempSync(join(tmpdir(), 'mediforce-e2e-skill-')), id);
    mkdirSync(join(folder, 'references'), { recursive: true });
    mkdirSync(join(folder, 'scripts'));
    mkdirSync(join(folder, 'assets'));
    const files = [
      { path: 'SKILL.md', contents: skillMd(id, 'Profile a CSV before SDTM mapping') },
      { path: 'references/domains.md', contents: '# DM, AE, LB\n' },
      { path: 'scripts/profile.py', contents: 'print("profile")\n' },
    ];
    for (const file of files) writeFileSync(join(folder, file.path), file.contents);
    writeFileSync(join(folder, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    try {
      await page.goto(`/${TEST_ORG_HANDLE}/skills/new`);
      await expect(page.getByTestId('skill-manifest')).toContainText('my-skill', { timeout: 30_000 });
      await page.getByLabel('Skill folder').setInputFiles(folder);

      const review = page.getByTestId('skill-upload-review');
      await expect(review).toContainText('Skipped, not text (1)');
      await expect(review).toContainText('assets/logo.png');
      await review.getByRole('button', { name: 'Replace files' }).click();
      await expect(page.getByTestId('skill-manifest')).toContainText(id);

      await page.getByRole('button', { name: 'Create skill' }).click();
      await expect(page).toHaveURL(new RegExp(`/skills/${TEST_ORG_HANDLE}/${id}$`), { timeout: 15_000 });

      const res = await page.request.get(`/api/skills/${id}?namespace=${TEST_ORG_HANDLE}`);
      expect(res.status(), await res.text()).toBe(200);
      const { skill } = (await res.json()) as { skill: { files: Array<{ path: string; contents: string }> } };
      expect([...skill.files].sort((left, right) => left.path.localeCompare(right.path))).toEqual(
        [...files].sort((left, right) => left.path.localeCompare(right.path)),
      );
    } finally {
      await deleteSkill(page, id);
    }
  });

  test('a delete blocked by an agent names that agent', async ({ page }) => {
    test.setTimeout(60_000);
    trackPageErrors(page);
    const stamp = Date.now();
    const id = `e2e-ui-held-${stamp}`;
    const agentName = `E2E Skill Holder ${stamp}`;
    // The refused DELETE is the point of this test.
    allowPageErrors(page, ['status of 409']);

    const skillRes = await page.request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, {
      data: { files: [{ path: 'SKILL.md', contents: skillMd(id, 'Derive ADaM ADSL') }] },
    });
    expect(skillRes.status(), await skillRes.text()).toBe(201);
    const agentRes = await page.request.post('/api/agents', {
      data: {
        name: agentName,
        iconName: 'Bot',
        description: 'Holds a skill',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        namespace: TEST_ORG_HANDLE,
        skills: [{ namespace: TEST_ORG_HANDLE, id }],
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const agentId = ((await agentRes.json()) as { agent: { id: string } }).agent.id;

    try {
      await page.goto(`/${TEST_ORG_HANDLE}/skills/${TEST_ORG_HANDLE}/${id}`);
      await page.getByRole('button', { name: 'Delete' }).click({ timeout: 30_000 });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Delete' }).click();
      // The server's refusal, not the dialog's own warning.
      await expect(dialog.getByRole('alert')).toContainText(agentName, { timeout: 15_000 });
      await expect(dialog.getByRole('alert')).toContainText('cannot be deleted while agents hold it');
    } finally {
      await page.request.delete(`/api/agents/${agentId}`);
      await deleteSkill(page, id);
    }
  });
});
