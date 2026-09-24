import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalCaseOutputSchema,
  EvaluatorOutputSchema,
  FreezeEvalDatasetOutputSchema,
  GetMcpEvalPolicyOutputSchema,
  ListEvalCasesOutputSchema,
  ListEvaluatorsOutputSchema,
  PreviewEvaluatorOutputSchema,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE, TEST_USER_ID } from '../helpers/constants';
import {
  AUTH_HEADERS,
  JSON_HEADERS,
  agentStepWorkflow,
  awaitFinishedAgentRun,
  startRun,
} from '../helpers/agent-step-runs';
import {
  setupMultiNamespaceCallers,
  sessionCookieHeaders,
  type MultiNamespaceFixture,
  type UserCaller,
} from '../helpers/multi-namespace';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace, seedPostgresWorkspaceMember } from '../helpers/postgres-seed';

/**
 * API E2E for the Evaluation entities of ADR-0023 phase 1b: a step's
 * Evaluators with their trust gate, a draft check previewed against a real
 * production output, "add to eval set" from that run, a frozen Eval Dataset,
 * and the default-deny MCP eval policy — all scoped to the step's workspace.
 *
 * The production run is driven with MOCK_AGENT=true (result `{ mock, summary }`);
 * `code` checks run locally under ALLOW_LOCAL_AGENTS=true.
 *
 * The workflow Access gates (ADR-0019) are exercised in a dedicated
 * `eval-access-org`, so no role holder joins the shared `test` workspace whose
 * roster other journeys render.
 */
const ACCESS_ORG_HANDLE = 'eval-access-org';
const RUN_ROLE = 'eval-access-runner';
const EDIT_ROLE = 'eval-access-editor';

/** A workspace member holding exactly `role`, with a live session. */
async function memberHolding(request: APIRequestContext, role: string): Promise<UserCaller> {
  const email = `${role}@mediforce.dev`;
  const password = `${role}-password-123456`;
  const uid = await createTestUser(email, password, role);
  await seedPostgresWorkspaceMember(ACCESS_ORG_HANDLE, uid, 'member', role);
  const granted = await request.put(`/api/namespaces/${ACCESS_ORG_HANDLE}/members/${uid}/roles`, {
    headers: JSON_HEADERS,
    data: { grants: [{ role, workflowName: null }] },
  });
  expect(granted.status(), await granted.text()).toBe(200);
  return { uid, sessionCookie: await signInAndGetSessionCookie(email, password) };
}

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

test.describe('Step Evaluation entities — API E2E', () => {
  // One production run is shared by every test, so they run on one worker.
  test.describe.configure({ mode: 'serial' });

  let callers: MultiNamespaceFixture;
  let step: { namespace: string; workflowName: string; stepId: string };
  let agentRunId: string;

  test.beforeAll(async ({ request }) => {
    callers = await setupMultiNamespaceCallers();
    const workflowName = `e2e-eval-entities-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }));
    agentRunId = (await awaitFinishedAgentRun(request, runId)).id;
    step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
  });

  test('a schema Evaluator counts at once; a code Evaluator counts only after a person approves its source', async ({ request }) => {
    const schema = EvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators', {
      ...step,
      name: 'summary-present',
      rule: 'The result carries a summary.',
      severity: 'critical',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201));
    expect(schema.evaluator.trust).toEqual({ trusted: true });

    const code = EvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators', {
      ...step,
      name: 'summary-not-empty',
      rule: 'The summary says something.',
      severity: 'major',
      check: {
        kind: 'code',
        runtime: 'javascript',
        source: "import { readFileSync, writeFileSync } from 'node:fs';\nconst { result } = JSON.parse(readFileSync('/output/input.json', 'utf-8'));\nwriteFileSync('/output/result.json', JSON.stringify({ passed: typeof result.summary === 'string' && result.summary.length > 0 }));",
      },
      origin: 'assistant',
    }, 201));
    expect(code.evaluator.trust).toEqual({ trusted: false, reason: 'source not approved' });

    // An API key has no identity of its own: the approver must be named.
    const anonymous = await request.post(`/api/evaluation/evaluators/${code.evaluator.id}/approve`, {
      headers: JSON_HEADERS, data: { version: 1 },
    });
    expect(anonymous.status()).toBe(400);
    const approved = EvaluatorOutputSchema.parse(await post(request, `/api/evaluation/evaluators/${code.evaluator.id}/approve`, {
      version: 1, uid: TEST_USER_ID,
    }));
    expect(approved.evaluator.trust).toEqual({ trusted: true });
    expect(approved.evaluator.latest.sourceApproval?.approvedBy).toBe(TEST_USER_ID);

    const listRes = await request.get(
      `/api/evaluation/evaluators?namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`,
      { headers: AUTH_HEADERS },
    );
    const { evaluators } = ListEvaluatorsOutputSchema.parse(await listRes.json());
    expect(evaluators.map((evaluator) => evaluator.name)).toEqual(['summary-not-empty', 'summary-present']);

    // Another workspace's user cannot see the step at all.
    const outsider = await request.get(
      `/api/evaluation/evaluators?namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`,
      { headers: sessionCookieHeaders(callers.outsider) },
    );
    expect(outsider.status()).toBe(404);

    // ...nor reach one of its Evaluators by id.
    const outsiderById = await request.get(`/api/evaluation/evaluators/${schema.evaluator.id}`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(outsiderById.status(), await outsiderById.text()).toBe(404);
  });

  test('a draft check is previewed against the step\'s real output without writing anything', async ({ request }) => {
    const preview = PreviewEvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators/preview', {
      ...step,
      check: { kind: 'schema', schema: { required: ['findings'] } },
    }));
    expect(preview.results).toEqual([
      { agentRunId, passed: false, value: 0, label: 'fail', comment: 'missing required keys: findings', error: null },
    ]);

    const code = PreviewEvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators/preview', {
      ...step,
      agentRunIds: [agentRunId],
      check: {
        kind: 'code',
        runtime: 'python',
        source: "import json\ndata = json.load(open('/output/input.json'))\njson.dump({'passed': 'mock' in data['result'], 'comment': str(len(data['trajectory'])) + ' trajectory entries'}, open('/output/result.json', 'w'))",
      },
    }));
    expect(code.results).toEqual([
      { agentRunId, passed: true, value: 1, label: 'pass', comment: '2 trajectory entries', error: null },
    ]);

    const scoresRes = await request.get(`/api/scores?agentRunId=${agentRunId}`, { headers: AUTH_HEADERS });
    expect(((await scoresRes.json()) as { scores: unknown[] }).scores).toEqual([]);
  });

  test('a production run becomes an Eval Case, and the live cases freeze into a Dataset version', async ({ request }) => {
    const unreviewed = await request.post('/api/evaluation/cases/from-agent-run', {
      headers: JSON_HEADERS, data: { agentRunId },
    });
    expect(unreviewed.status(), await unreviewed.text()).toBe(400);
    const otherStep = await request.post('/api/evaluation/cases/from-agent-run', {
      headers: JSON_HEADERS, data: { agentRunId, expectation: 'positive', step: { ...step, stepId: 'another-step' } },
    });
    expect(otherStep.status(), await otherStep.text()).toBe(400);

    const { evalCase } = EvalCaseOutputSchema.parse(await post(request, '/api/evaluation/cases/from-agent-run', {
      agentRunId, step, expectation: 'positive', split: 'holdout', origin: 'assistant',
    }, 201));
    expect(evalCase).toMatchObject({
      ...step,
      source: 'production',
      sourceAgentRunId: agentRunId,
      origin: 'assistant',
      expectation: 'positive',
      split: 'holdout',
      containsProductionData: true,
    });

    const { dataset } = FreezeEvalDatasetOutputSchema.parse(await post(request, '/api/evaluation/datasets', step, 201));
    expect(dataset).toMatchObject({ version: 1, caseIds: [evalCase.id], containsProductionData: true });

    // Another workspace's user cannot reach the case by id, and does not touch it.
    const outsiderArchive = await request.post(`/api/evaluation/cases/${evalCase.id}/archive`, {
      headers: sessionCookieHeaders(callers.outsider), data: { archived: true },
    });
    expect(outsiderArchive.status(), await outsiderArchive.text()).toBe(404);
    const casesRes = await request.get(
      `/api/evaluation/cases?namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`,
      { headers: AUTH_HEADERS },
    );
    const { cases } = ListEvalCasesOutputSchema.parse(await casesRes.json());
    expect(cases.find((listed) => listed.id === evalCase.id)?.archived).toBe(false);
  });

  test('an agent with no MCP servers has nothing to deny; an unknown server is refused', async ({ request }) => {
    const res = await request.get(
      `/api/evaluation/mcp-policy?namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`,
      { headers: AUTH_HEADERS },
    );
    expect(GetMcpEvalPolicyOutputSchema.parse(await res.json())).toEqual({ policy: null, servers: [] });

    const refused = await request.put('/api/evaluation/mcp-policy', {
      headers: JSON_HEADERS, data: { ...step, servers: { email: { mode: 'live' } } },
    });
    expect(refused.status(), await refused.text()).toBe(400);
  });

  test.describe('workflow Access', () => {
    let gatedStep: { namespace: string; workflowName: string; stepId: string };
    let runner: UserCaller;
    let editor: UserCaller;

    test.beforeAll(async ({ request }) => {
      await seedPostgresOrganizationNamespace(ACCESS_ORG_HANDLE, TEST_USER_ID, 'Eval Access Org');
      const workflowName = `e2e-eval-access-${randomUUID().slice(0, 8)}`;
      await post(
        request,
        `/api/workflow-definitions?namespace=${ACCESS_ORG_HANDLE}`,
        agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }),
        201,
      );
      const access = await request.put(
        `/api/workflow-definitions/${workflowName}/access?namespace=${ACCESS_ORG_HANDLE}`,
        { headers: JSON_HEADERS, data: { access: { run: [RUN_ROLE], edit: [EDIT_ROLE] } } },
      );
      expect(access.status(), await access.text()).toBe(200);
      gatedStep = { namespace: ACCESS_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
      runner = await memberHolding(request, RUN_ROLE);
      editor = await memberHolding(request, EDIT_ROLE);
    });

    test('changing a step\'s Evaluation needs the workflow\'s edit role', async ({ request }) => {
      const evaluator = {
        ...gatedStep,
        name: 'summary-present',
        rule: 'The result carries a summary.',
        severity: 'critical',
        check: { kind: 'schema', schema: { required: ['summary'] } },
      };

      const refused = await request.post('/api/evaluation/evaluators', {
        headers: sessionCookieHeaders(runner), data: evaluator,
      });
      expect(refused.status(), await refused.text()).toBe(403);
      const refusedPolicy = await request.put('/api/evaluation/mcp-policy', {
        headers: sessionCookieHeaders(runner), data: { ...gatedStep, servers: {} },
      });
      expect(refusedPolicy.status(), await refusedPolicy.text()).toBe(403);

      const created = await request.post('/api/evaluation/evaluators', {
        headers: sessionCookieHeaders(editor), data: evaluator,
      });
      expect(created.status(), await created.text()).toBe(201);
      const policy = await request.put('/api/evaluation/mcp-policy', {
        headers: sessionCookieHeaders(editor), data: { ...gatedStep, servers: {} },
      });
      expect(policy.status(), await policy.text()).toBe(200);
    });

    test('previewing a check runs the step\'s outputs, so it needs the workflow\'s run role', async ({ request }) => {
      const draft = { ...gatedStep, check: { kind: 'schema', schema: { required: ['summary'] } } };

      const refused = await request.post('/api/evaluation/evaluators/preview', {
        headers: sessionCookieHeaders(editor), data: draft,
      });
      expect(refused.status(), await refused.text()).toBe(403);

      const previewed = await request.post('/api/evaluation/evaluators/preview', {
        headers: sessionCookieHeaders(runner), data: draft,
      });
      expect(previewed.status(), await previewed.text()).toBe(200);
      expect(PreviewEvaluatorOutputSchema.parse(await previewed.json()).results).toEqual([]);
    });
  });
});
