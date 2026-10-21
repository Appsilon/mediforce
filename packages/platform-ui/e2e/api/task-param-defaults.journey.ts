import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';

/**
 * A human step's `params[].default` is `${...}`-interpolated against the run
 * when its task is created, so the reviewer edits the draft an earlier step
 * produced instead of pasting it in. Docker-free: a `reshape` action drafts the
 * e-mail, the human step opens on it.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const POLL_OPTIONS = { timeoutMs: 10_000, intervalMs: 200 };

interface TaskParam {
  name: string;
  default?: unknown;
}

test.describe('Human task param defaults — API E2E', () => {
  test('the created task carries defaults resolved from the previous step output', async ({ request }) => {
    const wdName = `e2e-param-defaults-${Date.now()}`;
    const wd = {
      name: wdName,
      title: 'E2E Param Defaults',
      steps: [
        {
          id: 'draft-email',
          name: 'Draft e-mail',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'reshape',
            config: {
              values: {
                subject: 'Open query on visit 3',
                body: 'Dear site,\nplease confirm the ALT value.',
                findings: ['Grade 5 AE unreported'],
              },
            },
          },
        },
        {
          id: 'edit-email',
          name: 'Edit e-mail',
          type: 'creation',
          executor: 'human',
          allowedRoles: ['operator'],
          params: [
            { name: 'subject', type: 'string', required: true, default: 'Re: ${steps.draft-email.subject}' },
            { name: 'body', type: 'textarea', required: true, default: '${steps.draft-email.body}' },
            { name: 'findings', type: 'textarea', default: '${steps.draft-email.findings}' },
            { name: 'cc', type: 'string', default: '${steps.draft-email.cc}' },
          ],
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'draft-email', to: 'edit-email' },
        { from: 'edit-email', to: 'done' },
      ],
    };

    const createWdRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
      headers: HEADERS,
      data: wd,
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    const triggerRes = await request.post('/api/processes', {
      headers: HEADERS,
      data: { namespace: TEST_ORG_HANDLE, definitionName: wdName, triggeredBy: 'e2e-test', triggerName: 'Start' },
    });
    expect(triggerRes.status(), await triggerRes.text()).toBe(201);
    const { run } = (await triggerRes.json()) as { run: { id: string } };

    const task = await pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${run.id}`, { headers: HEADERS });
        if (res.status() !== 200) return null;
        const body = (await res.json()) as { tasks: Array<{ id: string; stepId: string }> };
        return body.tasks.find((candidate) => candidate.stepId === 'edit-email') ?? null;
      },
      { ...POLL_OPTIONS, description: `edit-email task for ${run.id}` },
    );

    const taskRes = await request.get(`/api/tasks/${task.id}`, { headers: HEADERS });
    expect(taskRes.status(), await taskRes.text()).toBe(200);
    const { params } = (await taskRes.json()) as { params: TaskParam[] };
    const defaults = Object.fromEntries(params.map((param) => [param.name, param.default]));

    expect(defaults).toEqual({
      subject: 'Re: Open query on visit 3',
      body: 'Dear site,\nplease confirm the ALT value.',
      findings: '[\n  "Grade 5 AE unreported"\n]',
      cc: undefined,
    });
  });
});
