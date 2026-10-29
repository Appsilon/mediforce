import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { EvalRunOutputSchema, ListEvalRunsOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { trackPageErrors } from '../helpers/page-errors';
import { AUTH_HEADERS, JSON_HEADERS } from '../helpers/agent-step-runs';

/**
 * L4 journey for an Agent's Evaluation tab (ADR-0029): beside its
 * configuration, an Agent shows the version an Eval Run would assess, its own
 * Evaluators and Eval Runs; a person starts an Eval Run there, and the run's
 * report shows the exact configuration it assessed. Editing the Agent makes
 * it a new version the tab says has not been run.
 *
 * MOCK_AGENT=true: `claude-code-agent` is the mock agent, whose result is
 * `{ mock, summary }`.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

test.describe('Agent Evaluation tab', () => {
  test('a person runs an Agent\'s suite and reads the configuration it assessed', async ({ page, request }) => {
    test.setTimeout(120_000);
    trackPageErrors(page);
    const { agent } = await post(request, '/api/agents', {
      name: `AE grader ${randomUUID().slice(0, 8)}`,
      iconName: 'Bot',
      description: 'Grades adverse events',
      runtimeId: 'claude-code-agent',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: 'You grade adverse events by CTCAE v5.',
      inputDescription: 'Extracted AEs',
      outputDescription: 'Graded AEs',
      namespace: TEST_ORG_HANDLE,
    }) as { agent: { id: string } };
    const subject = { namespace: TEST_ORG_HANDLE, agentId: agent.id };
    await post(request, '/api/evaluation/evaluators', {
      ...subject, name: 'summary-present', rule: 'The result carries a summary.',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    });
    await post(request, '/api/evaluation/cases', {
      ...subject, name: 'Grade 4 neutropenia', expectation: 'positive',
      input: { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 }] }, previousStepOutputs: {} },
    });
    await post(request, '/api/evaluation/datasets', subject);

    try {
      await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/${agent.id}`);
      await page.getByRole('tab', { name: 'Evaluation' }).click();
      await expect(page).toHaveURL(/tab=evaluation/);
      await expect(page.getByTestId('agent-version')).toContainText('assesses agent version 1', { timeout: 15_000 });
      await page.getByTestId('evaluation-tab-evaluators').click();
      await expect(page.getByTestId('evaluator-row').filter({ hasText: 'summary-present' })).toBeVisible();
      await page.getByTestId('evaluation-tab-runs').click();
      await expect(page.getByTestId('eval-run-dataset')).toHaveText('Runs Dataset v1 (1 case(s)).');

      await page.getByLabel('Budget $').fill('1');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      const dialog = page.getByTestId('start-eval-run-dialog');
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await expect(page.getByTestId('eval-run-row')).toHaveCount(1, { timeout: 15_000 });

      const { evalRuns } = ListEvalRunsOutputSchema.parse(await (await request.get(
        `/api/evaluation/runs?namespace=${TEST_ORG_HANDLE}&agentId=${agent.id}`, { headers: AUTH_HEADERS },
      )).json());
      await pollUntil(
        async () => {
          const res = await request.get(`/api/evaluation/runs/${evalRuns[0]!.id}`, { headers: AUTH_HEADERS });
          return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' || null;
        },
        { description: `Eval Run ${evalRuns[0]!.id} to complete`, timeoutMs: 90_000 },
      );

      await page.getByTestId('eval-run-row').getByRole('link', { name: 'Details' }).click();
      const assessed = page.getByTestId('assessed-agent-configuration');
      await expect(assessed.getByText('Configuration assessed: agent version 1')).toBeVisible({ timeout: 15_000 });
      await assessed.getByText('System prompt').click();
      await expect(assessed.getByText('You grade adverse events by CTCAE v5.')).toBeVisible();

      // Saving a change to what the Agent does records version 2, which its next Eval Run assesses.
      const updated = await request.put(`/api/agents/${agent.id}`, {
        headers: JSON_HEADERS, data: { systemPrompt: 'You grade adverse events by CTCAE v6.' },
      });
      expect(updated.status(), await updated.text()).toBe(200);
      await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/${agent.id}?tab=evaluation`);
      await expect(page.getByTestId('agent-version')).toContainText('assesses agent version 2', { timeout: 15_000 });

      await page.getByRole('tab', { name: 'Configuration' }).click();
      await expect(page).not.toHaveURL(/tab=evaluation/);
      await expect(page.getByPlaceholder('e.g. Risk Analysis Agent')).toBeVisible();
    } finally {
      await request.delete(`/api/agents/${agent.id}`, { headers: AUTH_HEADERS });
    }
  });
});
