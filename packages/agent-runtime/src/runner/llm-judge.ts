import { z } from 'zod';
import type { AgentOutputEnvelope, StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import type { ReviewPlugin, ReviewPluginContext, ReviewPluginResult } from '../interfaces/review-plugin';
import type { LlmAnswerSchema, LlmClient, LlmMessage, LlmResponse } from '../interfaces/step-executor-plugin';
import type { StepFile, StepFileOmission } from '../workspace/workspace-reader';
import { parseAnswer } from './llm-answer';

export interface LlmJudgeConfig {
  readonly model: string;
  readonly rubric: string;
  /** What the step was given, so "given this input, is this output good?" is answerable. */
  readonly stepInput: Record<string, unknown> | null;
  /** Everything the agent did during the step — its reasoning, tool calls and their results — in order. */
  readonly trajectory: readonly StoredAgentTrajectoryEntry[];
  /** The files the step wrote, such as a report, as its commit left them. */
  readonly files: readonly StepFile[];
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

/**
 * What a provider constrains a verdict to. Providers do not constrain number
 * ranges or empty strings, so `JudgeAnswerSchema` still checks those.
 */
const VERDICT_ANSWER: LlmAnswerSchema = {
  name: 'verdict',
  schema: {
    type: 'object',
    properties: { rationale: { type: 'string' }, passed: { type: 'boolean' }, confidence: { type: 'number' } },
    required: ['rationale', 'passed', 'confidence'],
    additionalProperties: false,
  },
};

const ANSWER_VERDICT = 'Answer with one JSON object and nothing else: {"rationale": "<your explanation>", "passed": <true or false>, "confidence": <0 to 1>}.';

/** Keeps a judge prompt bounded when an input or output is a large document. */
const MAX_SECTION_CHARS = 20_000;
/** The agent's log may run long; its start and end are kept, the middle is cut. */
const MAX_TRAJECTORY_CHARS = 60_000;
const MAX_ENTRY_CHARS = 2_000;
/** What the agent wrote, such as a report, as large as a section so it reaches the judge whole. */
const MAX_TOOL_CALL_CHARS = MAX_SECTION_CHARS;
/** The files the step wrote, each cut as a section is; past this, a file is named, not shown. */
const MAX_FILES_CHARS = 60_000;

const OMITTED_FILE: Record<StepFileOmission, string> = {
  deleted: 'the step deleted it',
  binary: 'it is a binary file',
  too_large: 'it is larger than 1 MB',
  unreadable: 'the workspace could not be read',
};

/** Why a judge's answer could not be read, when the provider says more than the answer does. */
function unreadableAnswer(response: LlmResponse): string | null {
  if (response.stopReason === 'length') return 'the judge\'s answer was cut off at the output-token limit';
  if (response.content.trim() === '') return 'the judge gave an empty answer';
  return null;
}

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
  return `[${entry.seq}] ${kind}${tool === undefined ? '' : ` ${tool}`}: ${truncate(entryBody(entry), entry.input === undefined ? MAX_ENTRY_CHARS : MAX_TOOL_CALL_CHARS)}`;
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

/** Each file the step wrote under its path, in order, until the files' budget runs out. */
function formatFiles(files: readonly StepFile[]): string {
  let used = 0;
  return files.map((file) => {
    if (file.content === null) return `--- ${file.path}: not shown, ${OMITTED_FILE[file.omitted]}`;
    const text = truncate(file.content, MAX_SECTION_CHARS);
    if (used + text.length > MAX_FILES_CHARS) return `--- ${file.path}: not shown, no room left in this prompt`;
    used += text.length;
    return `--- ${file.path}\n${text}`;
  }).join('\n\n');
}

/**
 * What an `llm_judge` is sent: the rubric and how to answer, then the step's
 * input, the agent's log, its output, the files it wrote and its own summary. The judge and
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
        'You grade one step of a pharmaceutical workflow against a rubric. You see what the step was given, the agent\'s log of everything it did — its reasoning, every tool call and every tool result, in order — what it returned and the files it wrote.',
        `Rubric:\n${config.rubric}`,
        [
          'A person reads your rationale to accept or deny your verdict, so explain your judgment. Say what exactly contributed to the decision and why:',
          'cite the parts of the input, the output, the files and the log entries (by their [number]) that decided it, follow the agent\'s reasoning to where it went right or wrong,',
          'and name anything you could not verify.',
        ].join(' '),
        'Cite a log entry by its number in square brackets, one entry per bracket, right after what it shows: "the agent looked up the term [7][8]". Never a range, a list or a word inside the brackets — not [7-9], [7, 8] or [entry 7].',
        'confidence is how sure you are of your verdict, from 0 to 1: lower it when the evidence is incomplete, ambiguous or the rubric does not clearly decide the case.',
        `${ANSWER_VERDICT} Write the rationale before deciding.`,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        ...(config.stepInput === null ? [] : [`Step input:\n${section(config.stepInput)}`]),
        ...(config.trajectory.length === 0 ? [] : [`Agent log:\n${formatTrajectory(config.trajectory)}`]),
        `Step output:\n${section(output.result ?? null)}`,
        ...(config.files.length === 0 ? [] : [`Files the step wrote:\n${formatFiles(config.files)}`]),
        ...(output.reasoning_summary.length > 0 ? [`The agent's own summary:\n${output.reasoning_summary}`] : []),
        ANSWER_VERDICT,
      ].join('\n\n'),
    },
  ];
}

/**
 * An `llm_judge` Evaluator (ADR-0023 D3) on the `ReviewPlugin` seam. The judge
 * reads what the step was given, what it returned, the files it wrote and the agent's whole log,
 * explains what decided its verdict, then answers pass or fail with how
 * confident it is. An answer without all three throws — a judge that did not
 * judge must not be scored as a failure of the output.
 */
export class LlmJudgeReviewPlugin implements ReviewPlugin {
  constructor(private readonly config: LlmJudgeConfig) {}

  async review(context: ReviewPluginContext): Promise<LlmJudgeResult> {
    const response = await context.llm.complete(llmJudgeMessages(this.config, context.executorOutput), this.config.model, { answerSchema: VERDICT_ANSWER });

    const answer = parseAnswer(response.content, JudgeAnswerSchema);
    if (answer === null) {
      throw new Error(`${unreadableAnswer(response) ?? 'judge gave no usable verdict (rationale, passed, confidence 0–1)'}: ${response.content.slice(0, 300)}`);
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

/** What a provider constrains an agreement to; `AgreementAnswerSchema` still checks its range. */
const AGREEMENT_ANSWER: LlmAnswerSchema = {
  name: 'agreement',
  schema: {
    type: 'object',
    properties: { rationale: { type: 'string' }, agreement: { type: 'number' } },
    required: ['rationale', 'agreement'],
    additionalProperties: false,
  },
};

const ANSWER_AGREEMENT = 'Answer with one JSON object and nothing else: {"rationale": "<your explanation>", "agreement": <0 to 1>}.';

/** What the agreement judge is sent: how to score and the instructions, the case's overriding the check's, then the expected output and the output. */
export function outputAgreementMessages(config: Omit<OutputAgreementConfig, 'model'>): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You compare the output of one step of a pharmaceutical workflow with the output expected of it, and score how far they agree.',
        'agreement runs from 0 to 1: 1 when the output says the same as the expected output, 0 when it says something different. A difference that changes what a reader of the output would conclude or do lowers it a lot; a difference in form only — wording, ordering, formatting — lowers it little or not at all.',
        ...(config.instructions === null ? [] : [`On every case:\n${config.instructions}`]),
        ...(config.caseInstructions === null ? [] : [`On this case — this decides the comparison and overrides the instructions for every case where they conflict:\n${config.caseInstructions}`]),
        'Explain your score: name each difference that mattered and why, and the ones you treated as trivial.',
        `${ANSWER_AGREEMENT} Write the rationale before scoring.`,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        `Expected output:\n${section(config.expected)}`,
        `Output:\n${section(config.actual)}`,
        ANSWER_AGREEMENT,
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
  const response = await llm.complete(outputAgreementMessages(config), config.model, { answerSchema: AGREEMENT_ANSWER });

  const answer = parseAnswer(response.content, AgreementAnswerSchema);
  if (answer === null) {
    throw new Error(`${unreadableAnswer(response) ?? 'the agreement judge gave no usable agreement (rationale, agreement 0–1)'}: ${response.content.slice(0, 300)}`);
  }
  return { agreement: answer.agreement, rationale: answer.rationale, model: response.model };
}
