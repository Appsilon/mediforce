import { z } from 'zod';
import type { AgentOutputEnvelope, StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import type { ReviewPlugin, ReviewPluginContext, ReviewPluginResult } from '../interfaces/review-plugin';
import type { LlmClient, LlmMessage } from '../interfaces/step-executor-plugin';

export interface LlmJudgeConfig {
  readonly model: string;
  readonly rubric: string;
  /** What the step was given, so "given this input, is this output good?" is answerable. */
  readonly stepInput: Record<string, unknown> | null;
  /** Everything the agent did during the step — its reasoning, tool calls and their results — in order. */
  readonly trajectory: readonly StoredAgentTrajectoryEntry[];
}

export interface LlmJudgeResult extends ReviewPluginResult {
  readonly passed: boolean;
  readonly judgeModel: string;
}

const JudgeAnswerSchema = z.object({
  rationale: z.string().trim().min(1),
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
});

/** Keeps a judge prompt bounded when an input or output is a large document. */
const MAX_SECTION_CHARS = 20_000;
/** The agent's log may run long; its start and end are kept, the middle is cut. */
const MAX_TRAJECTORY_CHARS = 60_000;
const MAX_ENTRY_CHARS = 2_000;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… (truncated)` : text;
}

function section(value: unknown): string {
  return truncate(JSON.stringify(value, null, 2) ?? 'null', MAX_SECTION_CHARS);
}

function entryBody(entry: StoredAgentTrajectoryEntry): string {
  if (entry.text !== undefined) return entry.text;
  if (entry.input !== undefined) return JSON.stringify(entry.input);
  if (typeof entry.content === 'string') return entry.content;
  return JSON.stringify(entry.content ?? null);
}

function entryLine(entry: StoredAgentTrajectoryEntry): string {
  const kind = [entry.type, entry.subtype].filter((part) => part !== undefined).join('/');
  const tool = entry.tool ?? entry.tool_name;
  return `[${entry.seq}] ${kind}${tool === undefined ? '' : ` ${tool}`}: ${truncate(entryBody(entry), MAX_ENTRY_CHARS)}`;
}

/** The log, one numbered line per entry; over budget, as many entries from each end as fit. */
function formatTrajectory(entries: readonly StoredAgentTrajectoryEntry[]): string {
  const lines = entries.map(entryLine);
  if (lines.join('\n').length <= MAX_TRAJECTORY_CHARS) return lines.join('\n');
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  let front = 0;
  let back = lines.length - 1;
  while (front <= back) {
    const fromFront = head.length <= tail.length;
    const line = fromFront ? lines[front]! : lines[back]!;
    if (used + line.length > MAX_TRAJECTORY_CHARS) break;
    used += line.length + 1;
    if (fromFront) {
      head.push(line);
      front += 1;
    } else {
      tail.unshift(line);
      back -= 1;
    }
  }
  return [...head, `… ${lines.length - head.length - tail.length} entries omitted …`, ...tail].join('\n');
}

function parseAnswer<Answer>(content: string, schema: z.ZodType<Answer>): Answer | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(content.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * What an `llm_judge` is sent: the rubric and how to answer, then the step's
 * input, the agent's log, its output and its own summary. The judge and
 * anyone checking its verdict read the same messages.
 */
export function llmJudgeMessages(
  config: Omit<LlmJudgeConfig, 'model'>,
  output: Pick<AgentOutputEnvelope, 'result' | 'reasoning_summary'>,
): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You grade one step of a pharmaceutical workflow against a rubric. You see what the step was given, the agent\'s log of everything it did — its reasoning, every tool call and every tool result, in order — and what it returned.',
        `Rubric:\n${config.rubric}`,
        [
          'A person reads your rationale to accept or deny your verdict, so explain your judgment. Say what exactly contributed to the decision and why:',
          'cite the parts of the input, the output and the log entries (by their [number]) that decided it, follow the agent\'s reasoning to where it went right or wrong,',
          'and name anything you could not verify.',
        ].join(' '),
        'confidence is how sure you are of your verdict, from 0 to 1: lower it when the evidence is incomplete, ambiguous or the rubric does not clearly decide the case.',
        'Answer with one JSON object and nothing else: {"rationale": "<your explanation>", "passed": <true or false>, "confidence": <0 to 1>}. Write the rationale before deciding.',
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        ...(config.stepInput === null ? [] : [`Step input:\n${section(config.stepInput)}`]),
        ...(config.trajectory.length === 0 ? [] : [`Agent log:\n${formatTrajectory(config.trajectory)}`]),
        `Step output:\n${section(output.result ?? null)}`,
        ...(output.reasoning_summary.length > 0 ? [`The agent's own summary:\n${output.reasoning_summary}`] : []),
      ].join('\n\n'),
    },
  ];
}

/**
 * An `llm_judge` Evaluator (ADR-0023 D3) on the `ReviewPlugin` seam. The judge
 * reads what the step was given, what it returned and the agent's whole log,
 * explains what decided its verdict, then answers pass or fail with how
 * confident it is. An answer without all three throws — a judge that did not
 * judge must not be scored as a failure of the output.
 */
export class LlmJudgeReviewPlugin implements ReviewPlugin {
  constructor(private readonly config: LlmJudgeConfig) {}

  async review(context: ReviewPluginContext): Promise<LlmJudgeResult> {
    const response = await context.llm.complete(llmJudgeMessages(this.config, context.executorOutput), this.config.model);

    const answer = parseAnswer(response.content, JudgeAnswerSchema);
    if (answer === null) {
      throw new Error(`judge gave no usable verdict (rationale, passed, confidence 0–1): ${response.content.slice(0, 300)}`);
    }
    return {
      verdict: answer.passed ? 'approve' : 'reject',
      passed: answer.passed,
      reasoning: answer.rationale,
      confidence: answer.confidence,
      judgeModel: response.model,
    };
  }
}

export interface OutputAgreementConfig {
  readonly model: string;
  /** What the check treats as trivial or decisive on every case. */
  readonly instructions: string | null;
  /** What this Eval Case treats as trivial or decisive. */
  readonly caseInstructions: string | null;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface OutputAgreement {
  /** 0 when the outputs say different things, 1 when they say the same. */
  readonly agreement: number;
  readonly rationale: string;
  readonly model: string;
}

const AgreementAnswerSchema = z.object({
  rationale: z.string().trim().min(1),
  agreement: z.number().min(0).max(1),
});

/** What the agreement judge is sent: how to score, the instructions, then the expected output and the output. */
export function outputAgreementMessages(config: Omit<OutputAgreementConfig, 'model'>): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You compare the output of one step of a pharmaceutical workflow with the output expected of it, and score how far they agree.',
        'agreement runs from 0 to 1: 1 when the output says the same as the expected output, 0 when it says something different. A difference that changes what a reader of the output would conclude or do lowers it a lot; a difference in form only — wording, ordering, formatting — lowers it little or not at all.',
        ...(config.instructions === null ? [] : [`On every case:\n${config.instructions}`]),
        'Explain your score: name each difference that mattered and why, and the ones you treated as trivial.',
        'Answer with one JSON object and nothing else: {"rationale": "<your explanation>", "agreement": <0 to 1>}. Write the rationale before scoring.',
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        ...(config.caseInstructions === null ? [] : [`On this case:\n${config.caseInstructions}`]),
        `Expected output:\n${section(config.expected)}`,
        `Output:\n${section(config.actual)}`,
      ].join('\n\n'),
    },
  ];
}

/**
 * How far a step's output agrees with an Eval Case's expected output, 0–1,
 * as a model reads them with the check's and the case's instructions. An
 * answer without both throws — a comparison that did not happen must not be
 * scored as a disagreement.
 */
export async function judgeOutputAgreement(llm: LlmClient, config: OutputAgreementConfig): Promise<OutputAgreement> {
  const response = await llm.complete(outputAgreementMessages(config), config.model);

  const answer = parseAnswer(response.content, AgreementAnswerSchema);
  if (answer === null) {
    throw new Error(`the agreement judge gave no usable agreement (rationale, agreement 0–1): ${response.content.slice(0, 300)}`);
  }
  return { agreement: answer.agreement, rationale: answer.rationale, model: response.model };
}
