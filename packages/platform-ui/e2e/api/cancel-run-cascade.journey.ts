import { test, expect } from '../helpers/test-fixtures';
import { apiKeyHeaders } from '../helpers/multi-namespace';
import { RUN_CANCEL_CASCADE_API_ID } from '../helpers/seed-data';

const INSTANCE_ID = 'proc-cancel-cascade-api';
const STEP_EXECUTION_ID = 'exec-cancel-cascade-api';
const AGENT_RUN_ID = RUN_CANCEL_CASCADE_API_ID;

interface StepExecutionView {
  id: string;
  status: string;
  error: string | null;
  completedAt: string | null;
}

interface StepView {
  stepId: string;
  status: string;
  executions: StepExecutionView[];
}

interface StepsResponse {
  steps: StepView[];
}

interface AgentRunView {
  id: string;
  status: string;
  fallbackReason: string | null;
  completedAt: string | null;
}

interface AgentRunsResponse {
  runs: AgentRunView[];
}

test.describe('POST /api/processes/:id/cancel — API E2E', () => {
  test('reaps in-flight step execution and agent run rows', async ({ request }) => {
    const cancelRes = await request.post(`/api/processes/${INSTANCE_ID}/cancel`, {
      headers: apiKeyHeaders(),
      data: { reason: 'Cancelled by user' },
    });
    expect(cancelRes.status(), await cancelRes.text()).toBe(200);

    const stepsRes = await request.get(`/api/processes/${INSTANCE_ID}/steps`, {
      headers: apiKeyHeaders(),
    });
    expect(stepsRes.status(), await stepsRes.text()).toBe(200);
    const stepsBody = await stepsRes.json() as StepsResponse;
    const step = stepsBody.steps.find((entry) => entry.stepId === 'narrative-summary');
    expect(step?.status).toBe('failed');
    const stepExecution = stepsBody.steps
      .flatMap((step) => step.executions)
      .find((execution) => execution.id === STEP_EXECUTION_ID);
    expect(stepExecution).toMatchObject({
      id: STEP_EXECUTION_ID,
      status: 'failed',
      error: 'Cancelled by user',
    });
    expect(stepExecution?.completedAt).not.toBeNull();

    const agentRunsRes = await request.get(
      `/api/agent-runs?runId=${encodeURIComponent(INSTANCE_ID)}&limit=10`,
      { headers: apiKeyHeaders() },
    );
    expect(agentRunsRes.status(), await agentRunsRes.text()).toBe(200);
    const agentRunsBody = await agentRunsRes.json() as AgentRunsResponse;
    const agentRun = agentRunsBody.runs.find((run) => run.id === AGENT_RUN_ID);
    expect(agentRun).toMatchObject({
      id: AGENT_RUN_ID,
      status: 'error',
      fallbackReason: 'Cancelled by user',
    });
    expect(agentRun?.completedAt).toBe(stepExecution?.completedAt);
  });
});
