import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evalCaseFromRunCommand, evalCasePerturbCommand, evalCasesFromLabelsCommand, evalMcpPolicySetCommand } from '../commands/eval-cases';
import { evalEvaluatorLabelCommand } from '../commands/eval-evaluators';
import { captureOutput, jsonResponse } from './test-helpers';

const ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE = ['--base-url', 'http://localhost:5555'];
const STEP = ['--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes'];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mediforce eval', () => {
  it('case-from-run posts the Agent Run with the chosen expectation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      evalCase: {
        namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes',
        id: '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'From run', input: { triggerPayload: {}, previousStepOutputs: {} },
        workspaceSeedCommit: null, expectation: 'negative', notes: null, source: 'production', sourceAgentRunId: 'ar-1', perturbation: null, origin: 'user',
        split: 'holdout', containsProductionData: true, archived: false, createdBy: 'u-1', createdAt: '2026-09-23T08:00:00.000Z',
      },
    }, 201));
    const output = captureOutput();
    const code = await evalCaseFromRunCommand({ argv: ['ar-1', '--expectation', 'negative', '--split', 'holdout', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/cases/from-agent-run');
    expect(JSON.parse(String(init?.body))).toEqual({ agentRunId: 'ar-1', expectation: 'negative', split: 'holdout', origin: 'user' });
    expect(output.stdoutLines.join('\n')).toContain('(negative, holdout)');
  });

  it('case-perturb posts the synthesized case from the file for the step', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-cli-'));
    const file = join(dir, 'case.json');
    const spec = {
      name: 'Demographics missing',
      baseAgentRunId: 'ar-1',
      perturbation: { kind: 'missing_file', description: 'dm.csv removed' },
      fileChanges: [{ op: 'delete', path: 'data/dm.csv' }],
      expectation: 'negative',
      notes: 'Must NOT invent demographics.',
    };
    writeFileSync(file, JSON.stringify(spec));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      evalCase: {
        namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes',
        id: '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'Demographics missing', input: { triggerPayload: {}, previousStepOutputs: {} },
        workspaceSeedCommit: 'a1b2c3d4', expectation: 'negative', notes: 'Must NOT invent demographics.', source: 'synthesized', sourceAgentRunId: 'ar-1',
        perturbation: spec.perturbation, origin: 'user', split: 'dev', containsProductionData: true, archived: false, createdBy: 'u-1', createdAt: '2026-09-23T08:00:00.000Z',
      },
    }, 201));
    const output = captureOutput();
    const code = await evalCasePerturbCommand({ argv: [...STEP, '--file', file, ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/cases/perturbed');
    expect(JSON.parse(String(init?.body))).toEqual({
      ...spec, namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', inputChanges: [], split: 'dev', origin: 'user',
    });
    expect(output.stdoutLines.join('\n')).toContain('(missing_file, negative)');
  });

  it('cases-from-labels reports the cases added and the outputs skipped', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ cases: [], skipped: [{ agentRunId: 'ar-1', reason: 'already a case' }] }, 201));
    const output = captureOutput();
    const code = await evalCasesFromLabelsCommand({ argv: ['0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]![0]).toBe('http://localhost:5555/api/evaluation/evaluators/0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c/cases-from-labels');
    expect(output.stdoutLines).toEqual(['0 Eval Case(s) added', '  skipped ar-1: already a case']);
  });

  it('evaluator-label refuses both or neither of --pass and --fail', async () => {
    const output = captureOutput();
    const code = await evalEvaluatorLabelCommand({ argv: ['0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', '--agent-run', 'ar-1', ...BASE], env: ENV, output });
    expect(code).toBe(2);
  });

  it('mcp-policy-set sends the servers map from the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-cli-'));
    const file = join(dir, 'policy.json');
    writeFileSync(file, JSON.stringify({ edc: { mode: 'live', denyTools: ['write_record'] } }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      policy: {
        namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes',
        servers: { edc: { mode: 'live', denyTools: ['write_record'] } }, updatedBy: 'u-1', updatedAt: '2026-09-23T08:00:00.000Z',
      },
    }));
    const output = captureOutput();
    const code = await evalMcpPolicySetCommand({ argv: [...STEP, '--file', file, ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/mcp-policy');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes',
      servers: { edc: { mode: 'live', denyTools: ['write_record'] } },
    });
  });
});
