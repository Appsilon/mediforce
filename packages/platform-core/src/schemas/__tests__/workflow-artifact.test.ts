import { describe, it, expect } from 'vitest';
import {
  WorkflowArtifactSchema,
  WorkflowDefinitionSchema,
  WORKFLOW_ARTIFACT_MAX_BYTES,
  WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
} from '../workflow-definition';

const baseWd = {
  name: 'landing-zone',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'poll', name: 'Poll', type: 'creation' as const, executor: 'script' as const },
    { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
  ],
  transitions: [{ from: 'poll', to: 'done' }],
};

const withArtifacts = (artifacts: unknown) => ({ ...baseWd, artifacts });

describe('WorkflowArtifactSchema', () => {
  it('accepts a relative posix path and its text', () => {
    const parsed = WorkflowArtifactSchema.parse({
      path: 'scripts/sftp_poll.py',
      contents: 'print("hello")\n',
    });
    expect(parsed).toEqual({ path: 'scripts/sftp_poll.py', contents: 'print("hello")\n' });
  });

  it('accepts an empty file, which is a real thing to author', () => {
    expect(() => WorkflowArtifactSchema.parse({ path: '__init__.py', contents: '' })).not.toThrow();
  });

  for (const path of [
    '/etc/passwd',
    '../outside.py',
    'scripts/../../outside.py',
    'scripts\\windows.py',
    'scripts//double.py',
    './leading-dot.py',
    '',
  ]) {
    it(`refuses ${JSON.stringify(path)}, which does not name a file inside the workflow`, () => {
      // These paths are materialized onto the host before a run, so anything
      // that escapes the directory or cannot be created has to fail here rather
      // than at write time.
      expect(WorkflowArtifactSchema.safeParse({ path, contents: 'x' }).success).toBe(false);
    });
  }

  it('refuses the directory the engine owns inside a run workspace', () => {
    expect(WorkflowArtifactSchema.safeParse({ path: '.mediforce/output/x', contents: 'x' }).success)
      .toBe(false);
  });

  it('refuses a file bigger than one artifact may be', () => {
    const contents = 'x'.repeat(WORKFLOW_ARTIFACT_MAX_BYTES + 1);
    const result = WorkflowArtifactSchema.safeParse({ path: 'big.py', contents });
    expect(result.success).toBe(false);
  });

  it('measures the cap in bytes rather than characters', () => {
    // A definition is stored as JSON, so what has to fit is the encoded size:
    // one emoji is four bytes and would otherwise pass a character count.
    const contents = '🧬'.repeat(WORKFLOW_ARTIFACT_MAX_BYTES / 4);
    expect(WorkflowArtifactSchema.safeParse({ path: 'ok.py', contents }).success).toBe(true);
    expect(
      WorkflowArtifactSchema.safeParse({ path: 'over.py', contents: `${contents}🧬` }).success,
    ).toBe(false);
  });
});

describe('WorkflowDefinitionSchema — artifacts', () => {
  it('accepts a definition with no artifacts at all', () => {
    expect(() => WorkflowDefinitionSchema.parse(baseWd)).not.toThrow();
  });

  it('accepts the files a workflow needs beside its steps', () => {
    expect(() => WorkflowDefinitionSchema.parse(withArtifacts([
      { path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' },
      { path: 'scripts/sftp_poll.py', contents: 'print("poll")\n' },
      { path: 'skills/data-validator/SKILL.md', contents: '# Data validator\n' },
    ]))).not.toThrow();
  });

  it('refuses two artifacts at the same path, one of which would be lost', () => {
    const result = WorkflowDefinitionSchema.safeParse(withArtifacts([
      { path: 'scripts/run.py', contents: 'a' },
      { path: 'scripts/run.py', contents: 'b' },
    ]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('scripts/run.py');
  });

  it('refuses a file where another artifact needs a directory', () => {
    // `scripts` cannot be both a file and the directory holding `scripts/run.py`
    // once these are written to disk, so the definition is refused rather than
    // failing halfway through materializing a run.
    const result = WorkflowDefinitionSchema.safeParse(withArtifacts([
      { path: 'scripts', contents: 'a' },
      { path: 'scripts/run.py', contents: 'b' },
    ]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('scripts');
  });

  it('refuses a set of artifacts bigger than a definition should carry', () => {
    // The whole set rides in the definition row and is read on every fetch, so
    // the total is capped as well as each file. Bytes beyond this belong in an
    // image or a repository.
    const file = 'x'.repeat(WORKFLOW_ARTIFACT_MAX_BYTES);
    const count = Math.ceil(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES / WORKFLOW_ARTIFACT_MAX_BYTES) + 1;
    const artifacts = Array.from({ length: count }, (_, i) => ({ path: `f${String(i)}.py`, contents: file }));
    const result = WorkflowDefinitionSchema.safeParse(withArtifacts(artifacts));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/total/i);
  });
});
