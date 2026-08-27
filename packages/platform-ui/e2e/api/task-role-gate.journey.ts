import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  TEST_USER_ID,
  type UserCaller,
} from '../helpers/multi-namespace';

/**
 * API-level journey for the step role gate (ADR-0019, issue #1249).
 *
 * `step.allowedRoles` was authored, surfaced in the editor and documented as
 * "restrict who can act" while being checked by nothing: any member of the
 * workspace could claim and complete any human task. These tests drive the
 * gate through real Postgres, real middleware and real session cookies.
 *
 * Everything lives in a dedicated `role-gate-org` workspace, so no real role
 * holder is added to the shared `test` workspace whose roster other journeys
 * render. Every test starts its own run: completing a task advances it, and a
 * shared run would let one test finish another's.
 *
 * The file runs **serially**. Its workflows and role grants are one shared
 * fixture, and registering or granting the same thing from two workers at once
 * races — a duplicate-version insert on the definition, mutual clobbering on
 * the grant (a role write is a full replace). Serial also lets the fixture be
 * built check-then-create, which is what makes a retry reuse it instead of
 * re-registering it.
 */
const ORG_HANDLE = 'role-gate-org';
/** Transfer target — the workflow leaves the run's workspace and lands here. */
const TRANSFER_TARGET_HANDLE = 'role-gate-org-2';

/** Every workflow this journey registers, one per gate shape under test. */
const SINGLE_ROLE_WD = 'role-gate-single';
const TWO_ROLE_WD = 'role-gate-two';
const OPEN_WD = 'role-gate-open';
const ORPHAN_ROLE_WD = 'role-gate-orphan';
const TRANSFER_WD = 'role-gate-transfer';

interface Persona {
  readonly email: string;
  readonly password: string;
  readonly grants: ReadonlyArray<{ role: string; workflowName: string | null }>;
}

const PERSONAS = {
  /** Plain member of the workspace, holding nothing. */
  noRole: {
    email: 'role-gate-none@mediforce.dev',
    password: 'rolegatenone123456',
    grants: [],
  },
  /** Workspace-wide `gate-reviewer` — the grant the gate must honour. */
  wideReviewer: {
    email: 'role-gate-wide@mediforce.dev',
    password: 'rolegatewide123456',
    grants: [{ role: 'gate-reviewer', workflowName: null }],
  },
  /**
   * `gate-reviewer`, but narrowed to a different workflow. The scope column is
   * decoration unless this caller is refused on `role-gate-single`.
   */
  scopedElsewhere: {
    email: 'role-gate-scoped@mediforce.dev',
    password: 'rolegatescoped123456',
    grants: [{ role: 'gate-reviewer', workflowName: OPEN_WD }],
  },
  /**
   * Holds only the *second* role of the two-role step. The engine writes just
   * `allowedRoles[0]` into `HumanTask.assignedRole`, so a gate reading the task
   * would refuse this caller — the truncation the gate must not inherit.
   */
  secondRole: {
    email: 'role-gate-approver@mediforce.dev',
    password: 'rolegateapprover123456',
    grants: [{ role: 'gate-approver', workflowName: null }],
  },
} as const satisfies Record<string, Persona>;

type Callers = Record<keyof typeof PERSONAS, UserCaller>;

/**
 * Built once per worker, on first use. Playwright's `request` fixture is
 * per-test and cannot be reached from `beforeAll`, and every step here is
 * idempotent, so memoising the promise is what makes "once" true across the
 * workers this file is spread over.
 */
let fixture: Promise<Callers> | null = null;

function ensureFixture(request: APIRequestContext): Promise<Callers> {
  fixture ??= buildFixture(request);
  return fixture;
}

/** One human first step, gated by `allowedRoles` when the workflow declares any. */
function workflowWith(name: string, allowedRoles?: string[]): Record<string, unknown> {
  return {
    name,
    title: name,
    steps: [
      {
        id: 'act',
        name: 'Act',
        type: 'review',
        executor: 'human',
        verdicts: { approve: { target: 'done' } },
        ...(allowedRoles === undefined ? {} : { allowedRoles }),
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'act', to: 'done' }],
  };
}

/**
 * Register the definition unless it is already there. A re-registration would
 * be a new version rather than a no-op, and on a retry — a fresh worker with a
 * cold memo, against a workspace the previous attempt already seeded — that
 * collides on `(workspace, name, version)`.
 */
async function registerWorkflow(
  request: APIRequestContext,
  definition: Record<string, unknown>,
): Promise<void> {
  const name = definition.name as string;
  const existing = await request.get(
    `/api/workflow-definitions/${name}?namespace=${ORG_HANDLE}`,
    { headers: apiKeyHeaders() },
  );
  if (existing.status() === 200) return;

  const res = await request.post(
    `/api/workflow-definitions?namespace=${ORG_HANDLE}`,
    { headers: apiKeyHeaders(), data: definition },
  );
  expect(res.status(), await res.text()).toBe(201);
}

/**
 * Start a run of `workflowName` and return its freshly created human task.
 * A run per test rather than a shared fixture: completing one advances it.
 */
async function startTask(
  request: APIRequestContext,
  workflowName: string,
): Promise<string> {
  const triggered = await request.post('/api/processes', {
    headers: apiKeyHeaders(),
    data: {
      namespace: ORG_HANDLE,
      definitionName: workflowName,
      triggeredBy: 'role-gate-journey',
      triggerName: 'Start',
    },
  });
  expect(triggered.status(), await triggered.text()).toBe(201);
  const { run } = (await triggered.json()) as { run: { id: string } };

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/tasks?instanceId=${run.id}`, {
      headers: apiKeyHeaders(),
    });
    if (res.status() === 200) {
      const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string }> };
      const task = tasks.find((candidate) => candidate.stepId === 'act');
      if (task !== undefined) return task.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for the 'act' task of run ${run.id}`);
}

function claim(request: APIRequestContext, taskId: string, caller: UserCaller) {
  return request.post(`/api/tasks/${taskId}/claim`, {
    headers: sessionCookieHeaders(caller),
  });
}

function complete(request: APIRequestContext, taskId: string, caller: UserCaller) {
  return request.post(`/api/tasks/${taskId}/complete`, {
    headers: sessionCookieHeaders(caller),
    data: { kind: 'verdict', verdict: 'approve' },
  });
}

async function errorOf(res: { json: () => Promise<unknown> }): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

async function buildFixture(request: APIRequestContext): Promise<Callers> {
  await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Role Gate Org');
  await seedPostgresOrganizationNamespace(
    TRANSFER_TARGET_HANDLE,
    TEST_USER_ID,
    'Role Gate Transfer Target',
  );

  await registerWorkflow(request, workflowWith(SINGLE_ROLE_WD, ['gate-reviewer']));
  await registerWorkflow(request, workflowWith(TWO_ROLE_WD, ['gate-reviewer', 'gate-approver']));
  await registerWorkflow(request, workflowWith(OPEN_WD));
  await registerWorkflow(request, workflowWith(ORPHAN_ROLE_WD, ['gate-nobody']));
  await registerWorkflow(request, workflowWith(TRANSFER_WD, ['gate-reviewer']));

  const callers = {} as Callers;
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const uid = await createTestUser(persona.email, persona.password, key);
    const invited = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: { email: persona.email, namespaceHandle: ORG_HANDLE, role: 'member' },
    });
    expect(invited.status(), await invited.text()).toBe(201);

    const granted = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${uid}/roles`,
      { headers: apiKeyHeaders(), data: { grants: persona.grants } },
    );
    expect(granted.status(), await granted.text()).toBe(200);

    callers[key as keyof typeof PERSONAS] = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(persona.email, persona.password),
    };
  }
  return callers;
}

test.describe.configure({ mode: 'serial' });

test.describe('Step allowedRoles gate — API E2E', () => {
  test('a member holding none of the listed roles is refused the claim', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, SINGLE_ROLE_WD);

    const res = await claim(request, taskId, callers.noRole);

    expect(res.status(), await res.text()).toBe(403);
    const error = await errorOf(res);
    expect(error.code).toBe('forbidden');
    expect(error.message).toContain('gate-reviewer');
  });

  test('a workspace-wide holder claims the same step', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, SINGLE_ROLE_WD);

    const res = await claim(request, taskId, callers.wideReviewer);

    expect(res.status(), await res.text()).toBe(200);
    const { task } = (await res.json()) as { task: { status: string; assignedUserId: string } };
    expect(task.status).toBe('claimed');
    expect(task.assignedUserId).toBe(callers.wideReviewer.uid);
  });

  test('a holder scoped to another workflow is refused where a workspace-wide holder is not', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);
    const refusedTask = await startTask(request, SINGLE_ROLE_WD);
    const allowedTask = await startTask(request, SINGLE_ROLE_WD);

    const refused = await claim(request, refusedTask, callers.scopedElsewhere);
    expect(refused.status(), await refused.text()).toBe(403);

    const allowed = await claim(request, allowedTask, callers.wideReviewer);
    expect(allowed.status(), await allowed.text()).toBe(200);

    // The same grant does open its own workflow — the scope narrows, it does
    // not revoke.
    const ownWorkflowTask = await startTask(request, OPEN_WD);
    const onOwnWorkflow = await claim(request, ownWorkflowTask, callers.scopedElsewhere);
    expect(onOwnWorkflow.status(), await onOwnWorkflow.text()).toBe(200);
  });

  test('a two-role step accepts a holder of the second role', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, TWO_ROLE_WD);

    const res = await claim(request, taskId, callers.secondRole);

    expect(res.status(), await res.text()).toBe(200);
  });

  test('a step with no allowedRoles stays open to any member', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, OPEN_WD);

    const res = await claim(request, taskId, callers.noRole);

    expect(res.status(), await res.text()).toBe(200);
  });

  test('a role nobody holds fails closed, naming the cause and the fix', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, ORPHAN_ROLE_WD);

    const res = await claim(request, taskId, callers.wideReviewer);

    expect(res.status(), await res.text()).toBe(403);
    const error = await errorOf(res);
    expect(error.message).toContain("No one in this workspace holds 'gate-nobody'");
    expect(error.message).toContain('Settings');
  });

  test('complete is gated too — the same caller the claim refused cannot finish the task', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, SINGLE_ROLE_WD);

    const res = await complete(request, taskId, callers.noRole);

    expect(res.status(), await res.text()).toBe(403);
    expect((await errorOf(res)).message).toContain('gate-reviewer');
  });

  // `transferWorkflowNamespace` rewrites the definition's workspace and leaves
  // `process_instances.namespace` on the source, so the run's pinned read comes
  // back empty. Failing open there would hand anyone who can transfer a
  // workflow — any member, today — a way to un-gate its steps.
  test('the gate stays on for an in-flight run whose workflow was transferred away', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, TRANSFER_WD);

    const transferred = await request.post(
      `/api/workflow-definitions/${TRANSFER_WD}/transfer`,
      {
        headers: apiKeyHeaders(),
        data: { sourceNamespace: ORG_HANDLE, targetNamespace: TRANSFER_TARGET_HANDLE },
      },
    );
    expect(transferred.status(), await transferred.text()).toBe(200);

    // Refused even for the role holder: the definition is unreadable, so what
    // the author wrote cannot be checked either way.
    const res = await claim(request, taskId, callers.noRole);
    expect(res.status(), await res.text()).toBe(403);
    expect((await errorOf(res)).message).toContain('not readable in this workspace');
  });

  test('a holder claims and completes the task end to end', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, SINGLE_ROLE_WD);

    const claimed = await claim(request, taskId, callers.wideReviewer);
    expect(claimed.status(), await claimed.text()).toBe(200);

    const completed = await complete(request, taskId, callers.wideReviewer);
    expect(completed.status(), await completed.text()).toBe(200);
    const { task } = (await completed.json()) as { task: { status: string } };
    expect(task.status).toBe('completed');
  });
});
