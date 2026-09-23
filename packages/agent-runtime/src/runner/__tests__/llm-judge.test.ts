import { describe, it, expect, vi } from 'vitest';
import type { AgentOutputEnvelope } from '@mediforce/platform-core';
import { LlmJudgeReviewPlugin } from '../llm-judge';
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

function judge(llm: LlmClient) {
  const plugin = new LlmJudgeReviewPlugin({
    model: 'anthropic/claude-haiku-4.5',
    rubric: 'A fatal event must be graded 5.',
    choices: [{ label: 'correct', value: 1 }, { label: 'partly', value: 0.5 }, { label: 'wrong', value: 0 }],
    stepInput: { events: [{ term: 'Sepsis', outcome: 'fatal' }] },
    expectation: 'Must not grade the fatal sepsis event below 5.',
  });
  return plugin.review({ stepId: 'grade-aes', processInstanceId: 'run-1', executorOutput: envelope, iterationNumber: 0, llm });
}

function answering(content: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue({ content, model: 'anthropic/claude-haiku-4.5', usage: { promptTokens: 10, completionTokens: 5 } }),
  };
}

describe('LlmJudgeReviewPlugin', () => {
  it('asks for reasoning before the choice and maps the choice to a verdict', async () => {
    const llm = answering('{"reasoning": "Sepsis with fatal outcome graded 5.", "choice": "correct"}');
    const result = await judge(llm);

    expect(result).toEqual({
      verdict: 'approve',
      reasoning: 'Sepsis with fatal outcome graded 5.',
      confidence: 1,
      choice: 'correct',
      value: 1,
      judgeModel: 'anthropic/claude-haiku-4.5',
    });
    const [messages, model] = vi.mocked(llm.complete).mock.calls[0]!;
    expect(model).toBe('anthropic/claude-haiku-4.5');
    expect(messages[0]!.content).toContain('Write the reasoning before choosing');
    expect(messages[1]!.content).toContain('Must not grade the fatal sepsis event below 5.');
    expect(messages[1]!.content).toContain('"grade": 5');
  });

  it('passes a choice at exactly 0.5 and rejects below it', async () => {
    expect((await judge(answering('```json\n{"reasoning": "r", "choice": "partly"}\n```'))).verdict).toBe('approve');
    expect((await judge(answering('{"reasoning": "r", "choice": "wrong"}'))).verdict).toBe('reject');
  });

  it('throws when the judge names no listed choice', async () => {
    await expect(judge(answering('{"reasoning": "r", "choice": "maybe"}'))).rejects.toThrow(/no listed choice/);
    await expect(judge(answering('I think it is fine.'))).rejects.toThrow(/no listed choice/);
  });
});
