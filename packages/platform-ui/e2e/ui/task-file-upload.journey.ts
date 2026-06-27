import { readFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

// File-upload Human Task, post-ADR-0003: bytes flow through the headless
// attachments API (Postgres `task_attachments` + FilesystemBlobStore), no
// Firebase Storage. The journey rejects an over-limit file, uploads a real
// PDF, re-reads the completed task's attachment list, and downloads the file
// back byte-for-byte.

// Task-detail route loads the Human Task by id — no workflow-definition seed
// dependency, unlike the workflow run/step page.
const UPLOAD_TASK_URL = `/${TEST_ORG_HANDLE}/tasks/task-upload-docs`;

// A tiny but structurally-valid PDF — the bytes we expect to round-trip.
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n',
  'utf-8',
);

test.describe('Task File Upload Journey', () => {
  test('uploads a PDF to a Human Task, lists it, and downloads it byte-identical', async ({ page }, testInfo) => {
    await setupRecording(page, 'task-file-upload', testInfo);

    await page.goto(UPLOAD_TASK_URL);
    await expect(page.getByText(/drop files here/i)).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    const fileInput = page.getByTestId('file-input');

    // Over-limit guard: a file above the 100 MB ceiling is rejected client-side
    // with a friendly message, and never added to the upload list. Playwright
    // caps inline buffers at 50 MB, so stage the oversize file as a sparse file
    // on disk (instant, ~0 bytes) and upload it by path.
    const oversizePath = join(tmpdir(), 'mediforce-e2e-oversize.pdf');
    const handle = await open(oversizePath, 'w');
    await handle.truncate(100 * 1024 * 1024 + 1);
    await handle.close();
    await fileInput.setInputFiles(oversizePath);
    await expect(page.getByText(/too large \(max 100 MB\)/i)).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Now upload a valid PDF.
    await fileInput.setInputFiles({
      name: 'protocol.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });
    await expect(page.getByText('protocol.pdf')).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    await click(page, page.getByRole('button', { name: /^upload/i }));
    // Upload + task completion finished once either the success banner or the
    // completed list shows (the live view can land on either).
    await expect(
      page.getByText(/files uploaded successfully|1 file uploaded/i),
    ).toBeVisible({ timeout: 20_000 });

    // Re-read the completed task: its attachment list is served by the
    // attachments API (Postgres + blob store), not Firebase.
    await page.reload();
    await expect(page.getByText(/1 file uploaded/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('protocol.pdf').first()).toBeVisible({ timeout: 10_000 });
    await showResult(page);

    // Download the attachment and assert the bytes are identical to what we
    // uploaded — proves the full blob round-trip end to end.
    const downloadPromise = page.waitForEvent('download');
    await click(page, page.getByRole('button', { name: /download protocol\.pdf/i }));
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    const downloadedBytes = await readFile(downloadedPath);
    expect(downloadedBytes.equals(PDF_BYTES)).toBe(true);
    await showResult(page);

    await endRecording(page);
  });
});
