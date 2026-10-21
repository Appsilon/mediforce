import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';

/**
 * API E2E for `${…}` in an agent step's `stepParams`: the step maps
 * run values onto a flat input, so its Agent reads `documentType` and
 * `summary` at the top level instead of workflow-specific paths.
 *
 * Dry runs, so every agent step is the deterministic mock and no Docker is
 * needed. The input an agent step received is read back from its
 * `agent.step.started` audit event.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY };
const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };

interface AuditEvent {
  action: string;
  stepId?: string;
  inputSnapshot: Record<string, unknown>;
}

async function registerWorkflow(request: APIRequestContext, name: string, stepParams: Record<string, unknown>): Promise<void> {
  const res = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: JSON_HEADERS,
    data: {
      name,
      title: 'E2E Agent Step Params',
      triggerInput: [{ name: 'case', type: 'object', required: true }],
      steps: [
        { id: 'register_version', name: 'Register version', type: 'creation', executor: 'agent', autonomyLevel: 'L4' },
        { id: 'extract_document', name: 'Extract document', type: 'creation', executor: 'agent', autonomyLevel: 'L4', stepParams },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'register_version', to: 'extract_document' },
        { from: 'extract_document', to: 'done' },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function dryRunToTerminal(request: APIRequestContext, name: string): Promise<{ id: string; status: string; error: string | null }> {
  const triggerRes = await request.post('/api/processes', {
    headers: JSON_HEADERS,
    data: {
      namespace: TEST_ORG_HANDLE,
      definitionName: name,
      triggeredBy: 'e2e-test',
      triggerName: 'Start',
      payload: { case: { documentType: 'protocol' } },
      dryRun: true,
    },
  });
  expect(triggerRes.status(), await triggerRes.text()).toBe(201);
  const { run } = (await triggerRes.json()) as { run: { id: string } };

  const terminal = await pollUntil(
    async () => {
      const res = await request.get(`/api/runs/${run.id}`, { headers: AUTH_HEADERS });
      if (res.status() !== 200) return null;
      const body = (await res.json()) as { status: string; error: string | null };
      return body.status === 'completed' || body.status === 'failed' ? body : null;
    },
    { description: `run ${run.id} to reach a terminal status` },
  );
  return { id: run.id, ...terminal };
}

test.describe('Agent step stepParams mapping — API E2E', () => {
  test('an agent step receives its ${…} stepParams resolved against the run', async ({ request }) => {
    const name = `e2e-step-params-${Date.now()}`;
    await registerWorkflow(request, name, {
      documentType: '${triggerPayload.case.documentType}',
      summary: '${steps.register_version.summary}',
      language: 'en',
    });

    const run = await dryRunToTerminal(request, name);
    expect(run.status, run.error ?? '').toBe('completed');

    const auditRes = await request.get(`/api/processes/${run.id}/audit`, { headers: AUTH_HEADERS });
    expect(auditRes.status(), await auditRes.text()).toBe(200);
    const { events } = (await auditRes.json()) as { events: AuditEvent[] };
    const started = events.find((event) => event.action === 'agent.step.started' && event.stepId === 'extract_document');
    expect(started?.inputSnapshot).toMatchObject({
      documentType: 'protocol',
      summary: 'Mock output for step register_version',
      language: 'en',
    });
  });

  test('a stepParams reference the run does not have fails the run instead of reaching the agent', async ({ request }) => {
    const name = `e2e-step-params-missing-${Date.now()}`;
    await registerWorkflow(request, name, { pdfPath: '${steps.register_version.pdfPath}' });

    const run = await dryRunToTerminal(request, name);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('${steps.register_version.pdfPath}');

    const stepsRes = await request.get(`/api/processes/${run.id}/steps`, { headers: AUTH_HEADERS });
    expect(stepsRes.status(), await stepsRes.text()).toBe(200);
    const { steps } = (await stepsRes.json()) as { steps: Array<{ stepId: string; executions: Array<{ status: string; error: string | null }> }> };
    const extract = steps.find((step) => step.stepId === 'extract_document');
    expect(extract?.executions.map((execution) => execution.status)).toEqual(['failed']);
    expect(extract?.executions[0].error).toContain('${steps.register_version.pdfPath}');
  });
});
