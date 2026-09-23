import { z } from 'zod';
import type { JudgeChoice } from '@mediforce/platform-core';
import { JUDGE_PASS_VALUE } from '@mediforce/platform-core';
import type { ReviewPlugin, ReviewPluginContext, ReviewPluginResult } from '../interfaces/review-plugin';

export interface LlmJudgeConfig {
  readonly model: string;
  readonly rubric: string;
  readonly choices: readonly JudgeChoice[];
  /** What the step was given, so "given this input, is this output good?" is answerable. */
  readonly stepInput: Record<string, unknown> | null;
  /** What an Eval Case says the output must — or must not — contain. */
  readonly expectation: string | null;
}

export interface LlmJudgeResult extends ReviewPluginResult {
  readonly choice: string;
  readonly value: number;
  readonly judgeModel: string;
}

const JudgeAnswerSchema = z.object({
  reasoning: z.string().min(1),
  choice: z.string().min(1),
});

/** Keeps a judge prompt bounded when an input or output is a large document. */
const MAX_SECTION_CHARS = 20_000;

function section(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  return text.length > MAX_SECTION_CHARS ? `${text.slice(0, MAX_SECTION_CHARS)}\n… (truncated)` : text;
}

function parseAnswer(content: string): z.infer<typeof JudgeAnswerSchema> | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JudgeAnswerSchema.safeParse(JSON.parse(content.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * An `llm_judge` Evaluator (ADR-0023 D3) on the `ReviewPlugin` seam: reasoning
 * before the verdict, and a verdict that is one of a few discrete choices
 * mapped to a 0–1 value (layer-2 research § 3). A choice at or above 0.5
 * approves. An answer that names no listed choice throws — a judge that did
 * not judge must not be scored as a failure of the output.
 */
export class LlmJudgeReviewPlugin implements ReviewPlugin {
  constructor(private readonly config: LlmJudgeConfig) {}

  async review(context: ReviewPluginContext): Promise<LlmJudgeResult> {
    const labels = this.config.choices.map((choice) => `"${choice.label}"`).join(', ');
    const response = await context.llm.complete([
      {
        role: 'system',
        content: [
          'You grade the output of one step of a pharmaceutical workflow against a rubric.',
          `Rubric:\n${this.config.rubric}`,
          `Answer with one JSON object and nothing else: {"reasoning": "<why, citing the output>", "choice": <one of ${labels}>}. Write the reasoning before choosing.`,
        ].join('\n\n'),
      },
      {
        role: 'user',
        content: [
          ...(this.config.stepInput === null ? [] : [`Step input:\n${section(this.config.stepInput)}`]),
          ...(this.config.expectation === null ? [] : [`What the output must or must not contain:\n${this.config.expectation}`]),
          `Step output:\n${section(context.executorOutput.result ?? null)}`,
          ...(context.executorOutput.reasoning_summary.length > 0 ? [`The agent's own summary:\n${context.executorOutput.reasoning_summary}`] : []),
        ].join('\n\n'),
      },
    ], this.config.model);

    const answer = parseAnswer(response.content);
    const choice = answer === null
      ? undefined
      : this.config.choices.find((candidate) => candidate.label === answer.choice);
    if (answer === null || choice === undefined) {
      throw new Error(`judge answered with no listed choice (${labels}): ${response.content.slice(0, 300)}`);
    }
    return {
      verdict: choice.value >= JUDGE_PASS_VALUE ? 'approve' : 'reject',
      reasoning: answer.reasoning,
      confidence: choice.value,
      choice: choice.label,
      value: choice.value,
      judgeModel: response.model,
    };
  }
}
