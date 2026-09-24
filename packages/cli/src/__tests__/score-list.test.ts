import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scoreListCommand } from '../commands/score-list';
import { captureOutput, jsonResponse } from './test-helpers';

const SAMPLE_SCORE = {
  id: '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c',
  subject: { type: 'agent_run', id: '6f1c1b1e-0c5b-4a3e-9a51-2f6a8f0e4d21' },
  name: 'human_verdict',
  value: 1,
  label: 'approve',
  comment: null,
  source: 'human',
  createdBy: 'u-1',
  metadata: null,
  namespace: 'team-alpha',
  processInstanceId: 'inst-a',
  stepId: 'grade-aes',
  evaluatorId: null,
  supersedes: null,
  createdAt: '2026-09-23T08:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('score list command', () => {
  it('passes filters as query params and prints one row per Score', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ scores: [SAMPLE_SCORE] }));
    const output = captureOutput();
    const code = await scoreListCommand({
      argv: ['--agent-run', SAMPLE_SCORE.subject.id, '--name', 'human_verdict', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/\/api\/scores\?/);
    expect(url).toMatch(new RegExp(`agentRunId=${SAMPLE_SCORE.subject.id}`));
    expect(url).toMatch(/name=human_verdict/);
    expect(output.stdoutLines.join('\n')).toMatch(/1\.00 {2}human_verdict +approve +human +agent_run:6f1c1b1e/);
  });

  it('exits 2 when --step-id is given without --run-id', async () => {
    const output = captureOutput();
    const code = await scoreListCommand({ argv: ['--step-id', 'grade-aes'], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(2);
  });
});
