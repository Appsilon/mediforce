import { outputDifferences, type AgentRun, type EvalCase, type EvaluatorCheck, type JudgeCall } from '@mediforce/platform-core';
import {
  LlmJudgeReviewPlugin,
  judgeOutputAgreement,
  runCodeCheck,
  validateOutputSchema,
  type LlmClient,
} from '@mediforce/agent-runtime';
import type { EvaluatorOutcome } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { callOpenRouter, OpenRouterApiError, type OpenRouterRequest } from '../../../services/openrouter-client';
import { requireOpenRouterApiKey } from '../../../services/openrouter-key';
import type { ScoredRun } from './scored-run';

type LlmJudgeCheck = Extract<EvaluatorCheck, { kind: 'llm_judge' }>;
type ExpectedOutputCheck = Extract<EvaluatorCheck, { kind: 'expected_output' }>;

const CODE_CHECK_TIMEOUT_MS = 2 * 60_000;
/** Room for a rationale that cites what decided the verdict; a ceiling, so a short answer costs no more. */
const JUDGE_MAX_OUTPUT_TOKENS = 4000;
const JUDGE_RETRY_DELAY_MS = 2000;

/** A rate limit or a provider failure is asked once more before it errors the check. */
async function callJudgeModel(request: OpenRouterRequest): ReturnType<typeof callOpenRouter> {
  try {
    return await callOpenRouter(request);
  } catch (err) {
    if (err instanceof OpenRouterApiError === false || (err.status !== 429 && err.status < 500)) throw err;
    await new Promise((resolve) => setTimeout(resolve, JUDGE_RETRY_DELAY_MS));
    return callOpenRouter(request);
  }
}

/** The judge's model, through the platform's OpenRouter seam (mockable via `OPENROUTER_BASE_URL`). */
function openRouterJudgeClient(apiKey: string, model: string, onCall: (call: JudgeCall) => void): LlmClient {
  return {
    complete: async (messages) => {
      const startedAt = Date.now();
      const response = await callJudgeModel({
        model,
        apiKey,
        messages,
        temperature: 0,
        maxTokens: JUDGE_MAX_OUTPUT_TOKENS,
      });
      onCall({ model, ...response.usage, durationMs: Date.now() - startedAt, response: response.content });
      return { content: response.content, model, usage: response.usage, stopReason: response.finishReason };
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
  subject: ScoredRun,
  onJudgeCall: (call: JudgeCall) => void,
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
    llm: openRouterJudgeClient(apiKey, check.model, onJudgeCall),
  });
  return { ...binary(agentRun.id, verdict.passed, verdict.reasoning), confidence: verdict.confidence };
}

/**
 * Compares the output with the case's expected output: `exact` passes only
 * on no difference at all, `agreement` at the check's `minAgreement` or above.
 * A negative case's expected output is one to avoid, so `exact` reverses and
 * `agreement` passes at the check's `maxAgreement` or below.
 */
async function runExpectedOutputCheck(
  scope: CallerScope,
  check: ExpectedOutputCheck,
  subject: ScoredRun,
  evalCase: EvalCase | null,
  result: unknown,
  onJudgeCall: (call: JudgeCall) => void,
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
  const { agreement, rationale } = await judgeOutputAgreement(openRouterJudgeClient(apiKey, check.model, onJudgeCall), {
    model: check.model,
    instructions: check.instructions ?? null,
    caseInstructions: evalCase.agreementInstructions,
    expected: evalCase.expectedOutput,
    actual: result,
  });
  const passed = negative ? agreement <= check.maxAgreement : agreement >= check.minAgreement;
  const threshold = negative ? `a negative case passes at ${check.maxAgreement} or below` : `passes at ${check.minAgreement} or above`;
  return { ...binary(agentRun.id, passed, `Agreement ${agreement} (${threshold}). ${rationale}`), agreement };
}

/** Whether a run gave a result for a check to grade. */
export function producedResult(agentRun: AgentRun): boolean {
  const result = agentRun.envelope?.result;
  return result !== null && result !== undefined;
}

/**
 * Applies one check to one Agent Run's output. A run with no `result` fails
 * every check without running it. A check that cannot run — a crashing
 * script, a judge with no usable verdict — comes back as `error`, never as a
 * failed output: an Evaluator's defect is not the agent's. `onJudgeCall`
 * hears every judge call made, including one whose answer was unusable.
 */
export async function runEvaluatorCheck(
  scope: CallerScope,
  check: EvaluatorCheck,
  subject: ScoredRun,
  evalCase: EvalCase | null,
  onJudgeCall: (call: JudgeCall) => void = () => {},
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
        return await runJudgeCheck(scope, check, subject, onJudgeCall);
      case 'expected_output':
        return await runExpectedOutputCheck(scope, check, subject, evalCase, result, onJudgeCall);
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
