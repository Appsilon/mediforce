import { describe, it, expect } from 'vitest';
import { loadCaseSource } from '../case-source';
import { addStepRun, evaluationFixture, GRADED_RUN, STEP } from '../../__tests__/fixture';
import { gitWorkspace } from '../../__tests__/git-workspace';

describe('loadCaseSource', () => {
  it('rebuilds the step input from the trigger payload and the earlier steps\' outputs', async () => {
    const fixture = await evaluationFixture();
    const source = await loadCaseSource(fixture.scope(), GRADED_RUN, STEP, 'read');
    expect(source).toMatchObject({
      step: STEP,
      input: {
        triggerPayload: { studyId: 'CDISCPILOT01' },
        previousStepOutputs: { 'extract-aes': { events: [{ term: 'Sepsis', outcome: 'fatal' }] } },
      },
      bareRepoPath: null,
      workspaceSeedCommit: null,
    });
  });

  it('starts from the workspace the step saw: the parent of the commit it produced', async () => {
    const fixture = await evaluationFixture();
    const workspace = gitWorkspace({ 'data/ae.csv': 'AETERM\nSepsis\n' });
    try {
      await addStepRun(fixture, {
        instanceId: 'run-with-files', agentRunId: 'agent-run-with-files', result: {}, at: '2026-09-22T11:00:00.000Z',
        gitMetadata: { repoUrl: workspace.repoPath, commitSha: workspace.stepCommit },
      });
      const source = await loadCaseSource(fixture.scope(), 'agent-run-with-files', STEP, 'read');
      expect(source).toMatchObject({ bareRepoPath: workspace.repoPath, workspaceSeedCommit: workspace.seedCommit });
    } finally {
      workspace.remove();
    }
  });

  it('refuses an eval trial: its input is itself a case', async () => {
    const fixture = await evaluationFixture();
    await fixture.instanceRepo.update('run-graded', { evalRunId: 'eval-run-1' });
    await expect(loadCaseSource(fixture.scope(), GRADED_RUN, STEP, 'read')).rejects.toThrow('is an eval trial, not a production run');
  });
});
