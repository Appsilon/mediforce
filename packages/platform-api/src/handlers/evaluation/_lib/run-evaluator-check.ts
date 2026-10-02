import { outputDifferences, type EvalCase, type EvaluatorCheck } from '@mediforce/platform-core';
import {
  LlmJudgeReviewPlugin,
  judgeOutputAgreement,
  runCodeCheck,
  validateOutputSchema,
  type LlmClient,
} from '@mediforce/agent-runtime';
import type { EvaluatorOutcome } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { callOpenRouter } from '../../../services/openrouter-client';
import { requireOpenRouterApiKey } from '../../../services/openrouter-key';
import type { EvaluationSubject } from './evaluation-subject';

type LlmJudgeCheck = Extract<EvaluatorCheck, { kind: 'llm_judge' }>;
type ExpectedOutputCheck = Extract<EvaluatorCheck, { kind: 'expected_output' }>;

const CODE_CHECK_TIMEOUT_MS = 2 * 60_000;
/** Room for a rationale that cites what decided the verdict. */
const JUDGE_MAX_OUTPUT_TOKENS = 2000;

/** The tokens one LLM judge call spent, for whoever pays for it. */
export interface JudgeUsage {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** The judge's model, through the platform's OpenRouter seam (mockable via `OPENROUTER_BASE_URL`). */
function openRouterJudgeClient(apiKey: string, model: string, onUsage: (usage: JudgeUsage) => void): LlmClient {
  return {
    complete: async (messages) => {
      const response = await callOpenRouter({
        model,
        apiKey,
        messages,
        temperature: 0,
        maxTokens: JUDGE_MAX_OUTPUT_TOKENS,
      });
      onUsage({ model, ...response.usage });
      return { content: response.content, model, usage: response.usage };
    },
  };
}

function binary(agentRunId: string, passed: boolean, comment: string | null): EvaluatorOutcome {
  return { agentRunId, passed, value: passed ? 1 : 0, label: passed ? 'pass' : 'fail', confidence: null, agreement: null, comment, error: null };
}

/**
 * Asks an `llm_judge` about one Agent Run: its input, its log and its output.
 * A judge that gives no usable verdict comes back as `error`, never as a
 * failed output.
 */
async function runJudgeCheck(
  scope: CallerScope,
  check: LlmJudgeCheck,
  subject: EvaluationSubject,
  onJudgeUsage: (usage: JudgeUsage) => void,
): Promise<EvaluatorOutcome> {
  const { agentRun } = subject;
  const apiKey = await requireOpenRouterApiKey(scope, subject.instance.namespace ?? '');
  const judge = new LlmJudgeReviewPlugin({
    model: check.model,
    rubric: check.rubric,
    stepInput: subject.stepInput,
    trajectory: subject.trajectory,
  });
  const verdict = await judge.review({
    stepId: agentRun.stepId,
    processInstanceId: agentRun.processInstanceId,
    executorOutput: agentRun.envelope!,
    iterationNumber: 0,
    llm: openRouterJudgeClient(apiKey, check.model, onJudgeUsage),
  });
  return { ...binary(agentRun.id, verdict.passed, verdict.reasoning), confidence: verdict.confidence };
}

/**
 * Compares the output with the case's expected output: `exact` passes only
 * on no difference at all, `agreement` at the check's `minAgreement`. A
 * negative case's expected output is one to avoid, so the verdict reverses.
 */
async function runExpectedOutputCheck(
  scope: CallerScope,
  check: ExpectedOutputCheck,
  subject: EvaluationSubject,
  evalCase: EvalCase | null,
  result: unknown,
  onJudgeUsage: (usage: JudgeUsage) => void,
): Promise<EvaluatorOutcome> {
  const { agentRun } = subject;
  if (evalCase === null || evalCase.expectedOutput === null) {
    throw new Error('an expected-output check grades only an Eval Case trial whose case has an expected output');
  }
  const negative = evalCase.expectation === 'negative';
  if (evalCase.comparison === 'exact') {
    const differences = outputDifferences(evalCase.expectedOutput, result);
    const matches = differences.length === 0;
    const comment = matches
      ? `The output matches the expected output exactly${negative ? ' — an output this case must not get' : ''}.`
      : `The output differs from the expected output${negative ? ', as this case requires' : ''}: ${differences.join('; ')}`;
    return binary(agentRun.id, matches !== negative, comment);
  }
  const apiKey = await requireOpenRouterApiKey(scope, subject.instance.namespace ?? '');
  const { agreement, rationale } = await judgeOutputAgreement(openRouterJudgeClient(apiKey, check.model, onJudgeUsage), {
    model: check.model,
    instructions: check.instructions ?? null,
    caseInstructions: evalCase.agreementInstructions,
    expected: evalCase.expectedOutput,
    actual: result,
  });
  const agrees = agreement >= check.minAgreement;
  const floor = negative ? `a negative case passes below ${check.minAgreement}` : `passes at ${check.minAgreement}`;
  return { ...binary(agentRun.id, agrees !== negative, `Agreement ${agreement} (${floor}). ${rationale}`), agreement };
}

/**
 * Applies one check to one Agent Run's output. A run with no `result` fails
 * every check without running it. A check that cannot run — a crashing
 * script, a judge with no usable verdict — comes back as `error`, never as a
 * failed output: an Evaluator's defect is not the agent's. `onJudgeUsage`
 * hears every judge call made, including one whose answer was unusable.
 */
export async function runEvaluatorCheck(
  scope: CallerScope,
  check: EvaluatorCheck,
  subject: EvaluationSubject,
  evalCase: EvalCase | null,
  onJudgeUsage: (usage: JudgeUsage) => void = () => {},
): Promise<EvaluatorOutcome> {
  const { agentRun } = subject;
  const envelope = agentRun.envelope;
  const result = envelope?.result;
  if (envelope === null || result === null || result === undefined) {
    return binary(agentRun.id, false, `The Agent Run produced no result (status: ${agentRun.status})`);
  }

  try {
    switch (check.kind) {
      case 'schema': {
        const violation = validateOutputSchema(result, check.schema);
        return binary(agentRun.id, violation === null, violation);
      }
      case 'code': {
        const git = envelope.gitMetadata ?? null;
        const outcome = await runCodeCheck({
          runtime: check.runtime,
          source: check.source,
          input: {
            result,
            stepInput: subject.stepInput,
            trajectory: subject.trajectory,
            case: evalCase,
          },
          workspace: git === null ? null : { bareRepoPath: git.repoUrl, commit: git.commitSha },
          timeoutMs: CODE_CHECK_TIMEOUT_MS,
          label: agentRun.id.slice(0, 12),
        });
        return binary(agentRun.id, outcome.passed, outcome.comment);
      }
      case 'llm_judge':
        return await runJudgeCheck(scope, check, subject, onJudgeUsage);
      case 'expected_output':
        return await runExpectedOutputCheck(scope, check, subject, evalCase, result, onJudgeUsage);
    }
  } catch (err) {
    return {
      agentRunId: agentRun.id,
      passed: null,
      value: null,
      label: null,
      confidence: null,
      agreement: null,
      comment: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
