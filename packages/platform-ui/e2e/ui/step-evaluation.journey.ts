import { randomUUID } from 'node:crypto';
import { test, expect } from '../helpers/test-fixtures';
import { trackPageErrors } from '../helpers/page-errors';
import { agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * L4 journey for the workflow's Evaluation tab (ADR-0023 D14): pick the agent
 * step, ask the Evaluation Assistant, and decide its proposals — accepting the
 * Evaluator adds it to the step's list as one that counts, rejecting the Brief
 * draft leaves the Brief unwritten. The steps the assistant took stay listed
 * under its reply, and the panel widens from its left edge. The model is the
 * scripted mock OpenRouter.
 */
test.describe('Step Evaluation tab', () => {
  test('the assistant proposes; accepting a proposal creates it, rejecting one does not', async ({ page, request }) => {
    test.setTimeout(90_000);
    trackPageErrors(page);
    await seedEvaluationWorkspace();
    const workflowName = `e2e-eval-tab-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);
    await awaitFinishedAgentRun(request, runId);

    const question = `What should I check first? ${randomUUID()}`;
    const check = { kind: 'schema', schema: { required: ['summary'] } };
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check } }] },
      {
        toolCalls: [
          { name: 'propose_brief', arguments: { text: 'Grades **adverse events** for the DSMB; a missed grade 5 is critical.' } },
          { name: 'propose_evaluator', arguments: { name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical', check } },
        ],
      },
      { content: 'The summary check passed on the recent run. I drafted a Brief and proposed the check.' },
    ]);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await expect(page.getByText('No Evaluators yet.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/No Brief yet/)).toBeVisible();

    await page.getByRole('button', { name: 'Assistant settings' }).click();
    await expect(page.getByLabel('Evaluation Assistant Model')).toBeVisible();

    await page.getByTestId('evaluation-assistant-input').fill(question);
    await page.getByTestId('evaluation-assistant-send').click();
    await expect(page.getByText('The summary check passed on the recent run.')).toBeVisible({ timeout: 20_000 });

    await page.getByText('3 steps').click();
    const steps = page.getByTestId('assistant-activity-step');
    await expect(steps).toHaveText(['Previewing a check on real runs', 'Drafting the brief', 'Drafting an evaluator']);

    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(2);
    const briefCard = cards.filter({ hasText: 'Proposed Evaluation Brief' });
    const evaluatorCard = cards.filter({ hasText: 'Proposed Evaluator' });
    await expect(briefCard.getByText('adverse events')).toBeVisible();

    await briefCard.getByRole('button', { name: 'Reject' }).click();
    await expect(briefCard.getByText('Rejected')).toBeVisible();

    await evaluatorCard.getByTestId('proposal-accept').click();
    await expect(evaluatorCard.getByText('Accepted')).toBeVisible({ timeout: 10_000 });

    const row = page.getByTestId('evaluator-row').filter({ hasText: 'summary-present' });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('Counts')).toBeVisible();
    await expect(row.getByText(/from the assistant/)).toBeVisible();
    await expect(page.getByText(/No Brief yet/)).toBeVisible();

    const panel = page.getByTestId('evaluation-assistant');
    const narrow = (await panel.boundingBox())!.width;
    const handle = (await page.getByTestId('evaluation-assistant-resize').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 150, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(narrow + 100);
  });
});
