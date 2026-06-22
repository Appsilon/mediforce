/**
 * Tests for WorkspaceReader — read-only access to Output Files on run
 * branches in the bare repo. Real git via WorkspaceManager against temp dirs.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WorkflowWorkspace } from '@mediforce/platform-core';
import { WorkspaceManager } from '../workspace-manager';
import { WorkspaceReader } from '../workspace-reader';

describe('WorkspaceReader', () => {
  let dataDir: string;
  let manager: WorkspaceManager;
  let reader: WorkspaceReader;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'wsreader-data-'));
    manager = new WorkspaceManager({ dataDir });
    reader = new WorkspaceReader({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  async function commitOutputFiles(
    workflow: { name: string; namespace?: string },
    runId: string,
    stepId: string,
    files: Record<string, Buffer | string>,
  ): Promise<void> {
    const ws = await manager.createRunWorkspace({ ...workflow, workspace: {} as WorkflowWorkspace }, runId);
    for (const [relativePath, content] of Object.entries(files)) {
      const destPath = join(ws.path, '.mediforce', 'output', stepId, relativePath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content);
    }
    await manager.commitStep(ws, { stepId });
  }

  describe('listOutputFiles', () => {
    it('returns entries with stepId, name, path, and size across two steps', async () => {
      const workflow = { name: 'wd-list' };
      await commitOutputFiles(workflow, 'run-1', 'extract', {
        'report.csv': 'a,b\n1,2\n',
        'charts/plot.svg': '<svg/>',
      });
      await commitOutputFiles(workflow, 'run-1', 'summarize', {
        'summary.md': '# done',
      });

      const entries = await reader.listOutputFiles(workflow, 'run-1');
      const sorted = entries.sort((left, right) => left.path.localeCompare(right.path));

      expect(sorted).toEqual([
        {
          stepId: 'extract',
          name: 'charts/plot.svg',
          path: '.mediforce/output/extract/charts/plot.svg',
          size: Buffer.byteLength('<svg/>'),
        },
        {
          stepId: 'extract',
          name: 'report.csv',
          path: '.mediforce/output/extract/report.csv',
          size: Buffer.byteLength('a,b\n1,2\n'),
        },
        {
          stepId: 'summarize',
          name: 'summary.md',
          path: '.mediforce/output/summarize/summary.md',
          size: Buffer.byteLength('# done'),
        },
      ]);
    });

    it('resolves namespaced workflows to the right bare repo', async () => {
      const workflow = { name: 'wd-ns', namespace: 'team' };
      await commitOutputFiles(workflow, 'run-ns', 'step-1', { 'out.txt': 'hello' });

      const entries = await reader.listOutputFiles(workflow, 'run-ns');
      expect(entries).toHaveLength(1);
      expect(entries[0].path).toBe('.mediforce/output/step-1/out.txt');
    });

    it('returns [] for an unknown run on an existing repo', async () => {
      const workflow = { name: 'wd-known' };
      await commitOutputFiles(workflow, 'run-real', 'step-1', { 'out.txt': 'x' });

      expect(await reader.listOutputFiles(workflow, 'run-ghost')).toEqual([]);
    });

    it('returns [] when the bare repo does not exist', async () => {
      expect(await reader.listOutputFiles({ name: 'never-created' }, 'run-1')).toEqual([]);
    });

    it('returns [] when the run has no output files', async () => {
      const workflow = { name: 'wd-empty' };
      const ws = await manager.createRunWorkspace({ ...workflow, workspace: {} as WorkflowWorkspace }, 'run-empty');
      await writeFile(join(ws.path, 'unrelated.txt'), 'not an output file');
      await manager.commitStep(ws, { stepId: 'step-1' });

      expect(await reader.listOutputFiles(workflow, 'run-empty')).toEqual([]);
    });
  });

  describe('readOutputFile', () => {
    it('round-trips binary content byte-identically', async () => {
      const binary = Buffer.from(Array.from({ length: 256 }, (_, byteValue) => byteValue));
      const workflow = { name: 'wd-binary' };
      await commitOutputFiles(workflow, 'run-bin', 'render', { 'data.bin': binary });

      const result = await reader.readOutputFile(workflow, 'run-bin', '.mediforce/output/render/data.bin');

      expect(result).toBeInstanceOf(Buffer);
      expect(result!.equals(binary)).toBe(true);
    });

    it('returns null for a directory path instead of serving a tree listing', async () => {
      const workflow = { name: 'wd-dir-path' };
      await commitOutputFiles(workflow, 'run-dir', 'step-x', { 'sub/file.txt': 'nested content' });

      expect(await reader.readOutputFile(workflow, 'run-dir', '.mediforce/output/step-x')).toBeNull();
      expect(await reader.readOutputFile(workflow, 'run-dir', '.mediforce/output/step-x/sub')).toBeNull();
      // The blob itself stays readable.
      const blob = await reader.readOutputFile(workflow, 'run-dir', '.mediforce/output/step-x/sub/file.txt');
      expect(blob!.toString('utf-8')).toBe('nested content');
    });

    it('returns null for a missing file', async () => {
      const workflow = { name: 'wd-missing-file' };
      await commitOutputFiles(workflow, 'run-1', 'step-1', { 'real.txt': 'x' });

      expect(await reader.readOutputFile(workflow, 'run-1', '.mediforce/output/step-1/ghost.txt')).toBeNull();
    });

    it('returns null when the bare repo does not exist', async () => {
      expect(await reader.readOutputFile({ name: 'never-created' }, 'run-1', '.mediforce/output/s/x.txt')).toBeNull();
    });

    it('rejects paths containing .. segments', async () => {
      const workflow = { name: 'wd-traversal' };
      await expect(
        reader.readOutputFile(workflow, 'run-1', '.mediforce/output/step-1/../../../.git/config'),
      ).rejects.toThrow();
    });

    it('rejects paths outside .mediforce/output/', async () => {
      const workflow = { name: 'wd-outside' };
      await commitOutputFiles(workflow, 'run-1', 'step-1', { 'real.txt': 'x' });
      const ws = await manager.createRunWorkspace({ ...workflow, workspace: {} as WorkflowWorkspace }, 'run-1');
      await writeFile(join(ws.path, 'tracked-but-not-output.txt'), 'secret-ish');
      await manager.commitStep(ws, { stepId: 'step-2' });

      await expect(reader.readOutputFile(workflow, 'run-1', 'tracked-but-not-output.txt')).rejects.toThrow();
      await expect(reader.readOutputFile(workflow, 'run-1', '.mediforce/outputs/step-1/x.txt')).rejects.toThrow();
      await expect(reader.readOutputFile(workflow, 'run-1', '.mediforce/output/')).rejects.toThrow();
    });
  });
});
