import {
  JUDGE_PASS_VALUE,
  type EvalCase,
  type EvaluatorCheck,
} from '@mediforce/platform-core';
import {
  LlmJudgeReviewPlugin,
  runCodeCheck,
  validateOutputSchema,
  type LlmClient,
} from '@mediforce/agent-runtime';
import type { EvaluatorOutcome } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { callOpenRouter } from '../../../services/openrouter-client';
import { requireOpenRouterApiKey } from '../../../assistant-core';
import type { EvaluationSubject } from './evaluation-subject';

const CODE_CHECK_TIMEOUT_MS = 2 * 60_000;
const JUDGE_MAX_OUTPUT_TOKENS = 1000;

/** The judge's model, through the platform's OpenRouter seam (mockable via `OPENROUTER_BASE_URL`). */
function openRouterJudgeClient(apiKey: string): LlmClient {
  return {
    complete: async (messages, model) => {
      const response = await callOpenRouter({
        model: model!,
        apiKey,
        messages,
        temperature: 0,
        maxTokens: JUDGE_MAX_OUTPUT_TOKENS,
      });
      return { content: response.content, model: model!, usage: { promptTokens: 0, completionTokens: 0 } };
    },
  };
}

function binary(agentRunId: string, passed: boolean, comment: string | null): EvaluatorOutcome {
  return { agentRunId, passed, value: passed ? 1 : 0, label: passed ? 'pass' : 'fail', comment, error: null };
}

/**
 * Applies one check to one Agent Run's output. A run with no `result` fails
 * every check without running it. A check that cannot run — a crashing
 * script, a judge that names no choice — comes back as `error`, never as a
 * failed output: an Evaluator's defect is not the agent's.
 */
export async function runEvaluatorCheck(
  scope: CallerScope,
  check: EvaluatorCheck,
  subject: EvaluationSubject,
  evalCase: EvalCase | null,
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
      case 'llm_judge': {
        const apiKey = await requireOpenRouterApiKey(scope, subject.instance.namespace ?? '');
        const judge = new LlmJudgeReviewPlugin({
          model: check.model,
          rubric: check.rubric,
          choices: check.choices,
          stepInput: subject.stepInput,
          expectation: evalCase === null
            ? null
            : [`This is a ${evalCase.expectation} case.`, evalCase.notes].filter((part) => part !== null).join(' '),
        });
        const verdict = await judge.review({
          stepId: agentRun.stepId,
          processInstanceId: agentRun.processInstanceId,
          executorOutput: envelope,
          iterationNumber: 0,
          llm: openRouterJudgeClient(apiKey),
        });
        return {
          agentRunId: agentRun.id,
          passed: verdict.value >= JUDGE_PASS_VALUE,
          value: verdict.value,
          label: verdict.choice,
          comment: verdict.reasoning,
          error: null,
        };
      }
    }
  } catch (err) {
    return {
      agentRunId: agentRun.id,
      passed: null,
      value: null,
      label: null,
      comment: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
