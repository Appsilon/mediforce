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
 * API-level journey for the actionable task inbox (ADR-0019, issue #1251).
 *
 * `GET /api/tasks` returned every task in every workspace the caller belongs
 * to, so a workspace's whole queue read as everyone's inbox. `actionable=true`
 * narrows it to what the caller may actually act on — the same predicate
 * `claim` enforces — and omitting it still returns what it always returned.
 * These tests drive both through real Postgres, middleware and session cookies.
 *
 * Its own `inbox-org` workspace, for the same reason the role-gate journey has
 * one: role holders seeded into the shared `test` workspace would show up in
 * every other journey's member roster.
 *
 * The read-batching half of the acceptance criteria is asserted at L1
 * (`platform-api/src/handlers/tasks/__tests__/_actionable.test.ts`),
 * where the repository calls can be counted. HTTP cannot see them.
 *
 * The file runs **serially**: its workflows and role grants are one shared
 * fixture, and a role write is a full replace, so two workers granting at once
 * clobber each other.
 */
const ORG_HANDLE = 'inbox-org';

const GATED_WD = 'inbox-gated';
const OPEN_WD = 'inbox-open';
const OTHER_WD = 'inbox-other';

interface Persona {
  readonly email: string;
  readonly password: string;
  readonly grants: ReadonlyArray<{ role: string; workflowName: string | null }>;
}

const PERSONAS = {
  /** Workspace-wide `inbox-reviewer` — the gated step is theirs to take. */
  reviewer: {
    email: 'inbox-reviewer@mediforce.dev',
    password: 'inboxreviewer123456',
    grants: [{ role: 'inbox-reviewer', workflowName: null }],
  },
  /** Member of the same workspace, holding nothing. */
  plain: {
    email: 'inbox-plain@mediforce.dev',
    password: 'inboxplain123456',
    grants: [],
  },
  /**
   * `inbox-reviewer`, narrowed to a different workflow. Holding the role name
   * is not holding it here — the case a workspace-wide role lookup gets wrong.
   */
  scopedElsewhere: {
    email: 'inbox-scoped@mediforce.dev',
    password: 'inboxscoped123456',
    grants: [{ role: 'inbox-reviewer', workflowName: OTHER_WD }],
  },
} as const satisfies Record<string, Persona>;

type Callers = Record<keyof typeof PERSONAS, UserCaller>;

let fixture: Promise<Callers> | null = null;

function ensureFixture(request: APIRequestContext): Promise<Callers> {
  fixture ??= buildFixture(request);
  return fixture;
}

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

/** Register the definition unless it is already there — see the role-gate
 *  journey for why a re-registration is not a no-op. */
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

/** Start a run and return the id of the human task it parks on. */
async function startTask(
  request: APIRequestContext,
  workflowName: string,
): Promise<string> {
  const triggered = await request.post('/api/processes', {
    headers: apiKeyHeaders(),
    data: {
      namespace: ORG_HANDLE,
      definitionName: workflowName,
      triggeredBy: 'inbox-journey',
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

async function inboxOf(
  request: APIRequestContext,
  caller: UserCaller,
  query: string,
): Promise<string[]> {
  const res = await request.get(`/api/tasks?namespace=${ORG_HANDLE}${query}`, {
    headers: sessionCookieHeaders(caller),
  });
  expect(res.status(), await res.text()).toBe(200);
  const { tasks } = (await res.json()) as { tasks: Array<{ id: string }> };
  return tasks.map((task) => task.id);
}

async function buildFixture(request: APIRequestContext): Promise<Callers> {
  await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Inbox Org');

  await registerWorkflow(request, workflowWith(GATED_WD, ['inbox-reviewer']));
  await registerWorkflow(request, workflowWith(OPEN_WD));
  await registerWorkflow(request, workflowWith(OTHER_WD, ['inbox-reviewer']));

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

test.describe('Actionable task inbox — API E2E', () => {
  test('a gated task is in the role holder’s inbox and in nobody else’s', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, GATED_WD);

    expect(await inboxOf(request, callers.reviewer, '&actionable=true')).toContain(taskId);
    expect(await inboxOf(request, callers.plain, '&actionable=true')).not.toContain(taskId);
  });

  // The grant names the role but narrows it to another workflow, so it cannot
  // open this step — the case a workspace-wide "do they hold `reviewer`?" gets
  // wrong, and the reason the predicate is resolved per workflow.
  test('a holder scoped to another workflow does not see it either', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, GATED_WD);

    expect(await inboxOf(request, callers.scopedElsewhere, '&actionable=true')).not.toContain(
      taskId,
    );
    // The same grant does fill its own workflow's inbox — the scope narrows,
    // it does not revoke.
    const ownTaskId = await startTask(request, OTHER_WD);
    expect(await inboxOf(request, callers.scopedElsewhere, '&actionable=true')).toContain(
      ownTaskId,
    );
  });

  // §12: the narrowing is a default, not a deletion. Whatever the flag hides
  // stays one request — one click, in the UI — away.
  test('without the flag every member of the workspace still sees it', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, GATED_WD);

    for (const caller of [callers.reviewer, callers.plain, callers.scopedElsewhere]) {
      expect(await inboxOf(request, caller, '')).toContain(taskId);
    }
  });

  test('a step with no allowedRoles is in every member’s inbox', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, OPEN_WD);

    expect(await inboxOf(request, callers.plain, '&actionable=true')).toContain(taskId);
  });

  test('a claim moves the task into the claimer’s inbox and out of everyone else’s', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, OPEN_WD);

    const claimed = await request.post(`/api/tasks/${taskId}/claim`, {
      headers: sessionCookieHeaders(callers.plain),
    });
    expect(claimed.status(), await claimed.text()).toBe(200);

    expect(await inboxOf(request, callers.plain, '&actionable=true')).toContain(taskId);
    expect(await inboxOf(request, callers.reviewer, '&actionable=true')).not.toContain(taskId);
    // Still visible in the workspace view — claimed by someone else is not
    // hidden, it is just not yours.
    expect(await inboxOf(request, callers.reviewer, '')).toContain(taskId);
  });

  test('what the inbox offers, the claim accepts', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, GATED_WD);

    expect(await inboxOf(request, callers.reviewer, '&actionable=true')).toContain(taskId);

    const claimed = await request.post(`/api/tasks/${taskId}/claim`, {
      headers: sessionCookieHeaders(callers.reviewer),
    });
    expect(claimed.status(), await claimed.text()).toBe(200);
  });

  test('what the inbox hides, the claim refuses', async ({ request }) => {
    const callers = await ensureFixture(request);
    const taskId = await startTask(request, GATED_WD);

    expect(await inboxOf(request, callers.plain, '&actionable=true')).not.toContain(taskId);

    const refused = await request.post(`/api/tasks/${taskId}/claim`, {
      headers: sessionCookieHeaders(callers.plain),
    });
    expect(refused.status(), await refused.text()).toBe(403);
  });
});
