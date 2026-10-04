import { describe, it, expect, vi } from 'vitest';
import type { AgentOutputEnvelope, StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import { LlmJudgeReviewPlugin, judgeOutputAgreement } from '../llm-judge';
import type { LlmClient } from '../../interfaces/step-executor-plugin';

const envelope = {
  confidence: 0.92,
  reasoning_summary: 'Graded 3 AEs by CTCAE v5.',
  reasoning_chain: [],
  annotations: [],
  model: 'anthropic/claude-sonnet-4',
  duration_ms: 1200,
  result: { events: [{ term: 'Sepsis', grade: 5 }] },
} as unknown as AgentOutputEnvelope;

const trajectory: StoredAgentTrajectoryEntry[] = [
  { seq: 0, ts: '2026-10-01T10:00:00.000Z', type: 'assistant', text: 'The sepsis outcome is fatal, so CTCAE grade 5 applies.' },
  { seq: 1, ts: '2026-10-01T10:00:01.000Z', type: 'tool_use', tool: 'Read', input: { file_path: '/workspace/aes.csv' } },
  { seq: 2, ts: '2026-10-01T10:00:02.000Z', type: 'tool_result', tool: 'Read', content: 'term,outcome\nSepsis,fatal' },
];

function judge(llm: LlmClient, entries: StoredAgentTrajectoryEntry[] = trajectory) {
  const plugin = new LlmJudgeReviewPlugin({
    model: 'anthropic/claude-haiku-4.5',
    rubric: 'A fatal event must be graded 5.',
    stepInput: { events: [{ term: 'Sepsis', outcome: 'fatal' }] },
    trajectory: entries,
  });
  return plugin.review({ stepId: 'grade-aes', processInstanceId: 'run-1', executorOutput: envelope, iterationNumber: 0, llm });
}

function answering(content: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue({ content, model: 'anthropic/claude-haiku-4.5', usage: { promptTokens: 10, completionTokens: 5 } }),
  };
}

describe('LlmJudgeReviewPlugin', () => {
  it('returns pass or fail with the judge confidence and its rationale', async () => {
    const llm = answering('{"rationale": "The agent read the fatal outcome (log entry 2) and graded sepsis 5.", "passed": true, "confidence": 0.9}');
    const result = await judge(llm);

    expect(result).toEqual({
      verdict: 'approve',
      passed: true,
      reasoning: 'The agent read the fatal outcome (log entry 2) and graded sepsis 5.',
      confidence: 0.9,
      judgeModel: 'anthropic/claude-haiku-4.5',
    });
    const [messages, model] = vi.mocked(llm.complete).mock.calls[0]!;
    expect(model).toBe('anthropic/claude-haiku-4.5');
    expect(messages[0]!.content).toMatch(/explain/i);
    expect(messages[0]!.content).toMatch(/what exactly contributed/i);
    expect(messages[1]!.content).toContain('"grade": 5');
  });

  it('tells the judge to cite each log entry on its own as [n], never a range or a list', async () => {
    const llm = answering('{"rationale": "r", "passed": true, "confidence": 0.9}');
    await judge(llm);

    const system = vi.mocked(llm.complete).mock.calls[0]![0][0]!.content;
    expect(system).toContain('[7][8]');
    expect(system).toMatch(/never a range/i);
  });

  it('shows the judge everything the agent did during the step', async () => {
    const llm = answering('{"rationale": "r", "passed": false, "confidence": 0.7}');
    const result = await judge(llm);

    expect(result.verdict).toBe('reject');
    const userMessage = vi.mocked(llm.complete).mock.calls[0]![0][1]!.content;
    expect(userMessage).toContain('The sepsis outcome is fatal, so CTCAE grade 5 applies.');
    expect(userMessage).toContain('/workspace/aes.csv');
    expect(userMessage).toContain('Sepsis,fatal');
    expect(userMessage).toContain('Graded 3 AEs by CTCAE v5.');
  });

  it('keeps the start and end of a log too long for the prompt', async () => {
    const long = Array.from({ length: 400 }, (_unused, seq): StoredAgentTrajectoryEntry => ({
      seq, ts: '2026-10-01T10:00:00.000Z', type: 'assistant', text: `step ${seq} ${'x'.repeat(300)}`,
    }));
    const llm = answering('{"rationale": "r", "passed": true, "confidence": 0.8}');
    await judge(llm, long);

    const userMessage = vi.mocked(llm.complete).mock.calls[0]![0][1]!.content;
    expect(userMessage).toContain('step 0 ');
    expect(userMessage).toContain('step 399 ');
    expect(userMessage).toMatch(/entries omitted/);
    expect(userMessage.length).toBeLessThan(120_000);
  });

  it('throws when the judge gives no rationale, verdict or confidence in range', async () => {
    await expect(judge(answering('{"rationale": "", "passed": true, "confidence": 0.9}'))).rejects.toThrow(/no usable verdict/);
    await expect(judge(answering('{"rationale": "r", "passed": "yes", "confidence": 0.9}'))).rejects.toThrow(/no usable verdict/);
    await expect(judge(answering('{"rationale": "r", "passed": true, "confidence": 1.4}'))).rejects.toThrow(/no usable verdict/);
    await expect(judge(answering('I think it is fine.'))).rejects.toThrow(/no usable verdict/);
  });

  it('reads an answer wrapped in a code fence', async () => {
    const result = await judge(answering('```json\n{"rationale": "r", "passed": false, "confidence": 0.55}\n```'));
    expect(result).toMatchObject({ passed: false, confidence: 0.55 });
  });
});

describe('judgeOutputAgreement', () => {
  const compare = (llm: LlmClient, caseInstructions: string | null = 'Differences in summary are trivial; a changed grade means low agreement.') => judgeOutputAgreement(llm, {
    model: 'anthropic/claude-haiku-4.5',
    instructions: 'Wording is never decisive.',
    caseInstructions,
    expected: { events: [{ term: 'Sepsis', grade: 5 }], summary: 'One fatal event.' },
    actual: { events: [{ term: 'Sepsis', grade: 4 }], summary: 'A fatal event.' },
  });

  it('returns how far the output agrees with the expected output, and why', async () => {
    const llm = answering('{"rationale": "The grade changed from 5 to 4.", "agreement": 0.2}');
    expect(await compare(llm)).toEqual({ agreement: 0.2, rationale: 'The grade changed from 5 to 4.', model: 'anthropic/claude-haiku-4.5' });

    const [messages, model] = vi.mocked(llm.complete).mock.calls[0]!;
    expect(model).toBe('anthropic/claude-haiku-4.5');
    expect(messages[0]!.content).toContain('Wording is never decisive.');
    expect(messages[1]!.content).toContain('"grade": 5');
    expect(messages[1]!.content).toContain('"grade": 4');
  });

  it('puts the case instructions right after the every-case ones, as overriding them', async () => {
    const llm = answering('{"rationale": "r", "agreement": 1}');
    await compare(llm);
    const [system, user] = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(system!.content).toContain(
      'Wording is never decisive.\n\nOn this case — this decides the comparison and overrides the instructions for every case where they conflict:\nDifferences in summary are trivial; a changed grade means low agreement.',
    );
    expect(user!.content).not.toContain('a changed grade means low agreement');
  });

  it('leaves out case instructions a case does not give', async () => {
    const llm = answering('{"rationale": "r", "agreement": 1}');
    await compare(llm, null);
    expect(vi.mocked(llm.complete).mock.calls[0]![0][0]!.content).not.toMatch(/this case/i);
  });

  it('throws on an answer without an agreement from 0 to 1, so it is never scored as a disagreement', async () => {
    await expect(compare(answering('{"rationale": "r", "agreement": 7}'))).rejects.toThrow(/no usable agreement/);
    await expect(compare(answering('They mostly agree.'))).rejects.toThrow(/no usable agreement/);
  });
});
