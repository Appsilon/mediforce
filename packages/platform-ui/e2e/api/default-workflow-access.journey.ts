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
 * API-level journey for the default access a workflow's first version is
 * registered with (ADR-0020), driven through real Postgres, real middleware
 * and real session cookies.
 *
 * The feature is one sentence — granting somebody `executor` lets them run the
 * workflows this workspace creates, without an admin opening the Access tab —
 * and it has two failure modes that only a full round-trip catches:
 *
 * 1. **The author locked out of their own workflow.** The seeded `edit` list
 *    names roles they need not hold, and their next Save answers to it.
 * 2. **Automation gated on roles nobody holds.** The CLI and the seeds
 *    register as a system actor with no uid to grant, so a gate seeded there
 *    would strand every workflow a deployment ships with.
 *
 * Its own `default-access-org`, so no grant lands in a workspace whose roster
 * other journeys render. Serial: the workflows and grants here are one shared
 * fixture.
 */
const ORG_HANDLE = 'default-access-org';

/** Registered by a person — the workflow that gets the defaults. */
const AUTHORED_WD = 'default-access-authored';
/** Registered by the API key — the control that must stay open. */
const AUTOMATED_WD = 'default-access-automated';
/** Its human step is restricted to a role nobody in the workspace holds. */
const GATED_STEP_WD = 'default-access-gated-step';

interface Persona {
  readonly email: string;
  readonly password: string;
}

const PERSONAS = {
  /** Registers `AUTHORED_WD`, and must still be able to save v2 of it. */
  author: {
    email: 'default-access-author@mediforce.dev',
    password: 'defaultaccessauthor123456',
  },
  /** A colleague holding nothing, until the test grants them `executor`. */
  colleague: {
    email: 'default-access-colleague@mediforce.dev',
    password: 'defaultaccesscolleague123456',
  },
} as const satisfies Record<string, Persona>;

type Callers = Record<keyof typeof PERSONAS, UserCaller>;

let fixture: Promise<Callers> | null = null;

function ensureFixture(request: APIRequestContext): Promise<Callers> {
  fixture ??= buildFixture(request);
  return fixture;
}

function workflowNamed(name: string, allowedRoles?: string[]): Record<string, unknown> {
  return {
    name,
    title: name,
    steps: [
      {
        id: 'act',
        name: 'Act',
        type: 'review',
        executor: 'human',
        ...(allowedRoles === undefined ? {} : { allowedRoles }),
        verdicts: { approve: { target: 'done' } },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'act', to: 'done' }],
  };
}

function register(
  request: APIRequestContext,
  name: string,
  headers: Record<string, string>,
  allowedRoles?: string[],
) {
  return request.post(`/api/workflow-definitions?namespace=${ORG_HANDLE}`, {
    headers,
    data: workflowNamed(name, allowedRoles),
  });
}

/**
 * Register only if the name is free. The seeding rule is "v1 only", so a
 * re-run against a database a previous run left behind must not register a v2
 * as its fixture — that would be a different scenario wearing the same name.
 */
async function registerOnce(
  request: APIRequestContext,
  name: string,
  headers: Record<string, string>,
  allowedRoles?: string[],
): Promise<void> {
  const existing = await request.get(
    `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${ORG_HANDLE}`,
    { headers: apiKeyHeaders() },
  );
  if (existing.status() === 200) return;
  const res = await register(request, name, headers, allowedRoles);
  expect(res.status(), await res.text()).toBe(201);
}


/** The lists a person-registered workflow is seeded with. */
const DEFAULT_ACCESS = {
  run: ['executor', 'workflow-manager'],
  edit: ['editor', 'workflow-manager'],
};

function accessUrl(name: string): string {
  return `/api/workflow-definitions/${encodeURIComponent(name)}/access?namespace=${ORG_HANDLE}`;
}

function readAccess(request: APIRequestContext, name: string, caller: UserCaller) {
  return request.get(
    `/api/workflow-definitions/${encodeURIComponent(name)}/access?namespace=${ORG_HANDLE}`,
    { headers: sessionCookieHeaders(caller) },
  );
}

function startRun(request: APIRequestContext, name: string, caller: UserCaller) {
  return request.post('/api/processes', {
    headers: sessionCookieHeaders(caller),
    data: {
      namespace: ORG_HANDLE,
      definitionName: name,
      triggeredBy: 'default-access-journey',
      triggerName: 'Start',
    },
  });
}

/** The run's human task, once the engine has created it. */
async function waitForActTask(request: APIRequestContext, runId: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: apiKeyHeaders() });
    if (res.status() === 200) {
      const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string }> };
      const task = tasks.find((candidate) => candidate.stepId === 'act');
      if (task !== undefined) return task.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for the 'act' task of run ${runId}`);
}

async function buildFixture(request: APIRequestContext): Promise<Callers> {
  await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Default Access Org');

  const callers = {} as Callers;
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const uid = await createTestUser(persona.email, persona.password, key);
    const invited = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: { email: persona.email, namespaceHandle: ORG_HANDLE, role: 'member' },
    });
    expect(invited.status(), await invited.text()).toBe(201);
    callers[key as keyof typeof PERSONAS] = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(persona.email, persona.password),
    };
  }

  // A role write is a full replace, so this states the colleague's starting
  // point rather than assuming it. Without it a re-run inherits the `executor`
  // grant a previous run made, and "refused both verbs" tests nothing. The
  // author's grants are deliberately left alone: their `workflow-manager` on
  // AUTHORED_WD is written by the registration below, which a re-run skips.
  const cleared = await request.put(
    `/api/namespaces/${ORG_HANDLE}/members/${callers.colleague.uid}/roles`,
    { headers: apiKeyHeaders(), data: { grants: [] } },
  );
  expect(cleared.status(), await cleared.text()).toBe(200);

  await registerOnce(request, AUTHORED_WD, sessionCookieHeaders(callers.author));
  await registerOnce(request, AUTOMATED_WD, apiKeyHeaders());
  await registerOnce(request, GATED_STEP_WD, sessionCookieHeaders(callers.author), ['engineer']);

  return callers;
}

test.describe.configure({ mode: 'serial' });

test.describe('Default workflow access — API E2E', () => {
  test('a workflow a person registers comes back gated by the built-in roles', async ({ request }) => {
    const callers = await ensureFixture(request);

    const res = await readAccess(request, AUTHORED_WD, callers.author);

    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      access: { run: string[]; edit: string[] };
      caller: { mayRun: boolean; mayEdit: boolean };
    };
    expect(body.access).toEqual(DEFAULT_ACCESS);
    // The author holds `workflow-manager` narrowed to this workflow, so the
    // screen offers both verbs rather than greying out controls the server
    // would in fact allow.
    expect(body.caller).toEqual({ mayRun: true, mayEdit: true });
  });

  test('the author can still save another version of their own workflow', async ({ request }) => {
    const callers = await ensureFixture(request);

    const saved = await register(request, AUTHORED_WD, sessionCookieHeaders(callers.author));

    // The regression the creator grant exists to prevent: the `edit` list the
    // first registration seeded names roles its author need not hold, and
    // every later Save answers to it. The version is whatever the workflow is
    // up to — the assertion is that this is not a 403.
    expect(saved.status(), await saved.text()).toBe(201);
    expect(((await saved.json()) as { version: number }).version).toBeGreaterThan(1);
  });

  test('a colleague holding nothing is refused both verbs', async ({ request }) => {
    const callers = await ensureFixture(request);

    const started = await startRun(request, AUTHORED_WD, callers.colleague);
    expect(started.status(), await started.text()).toBe(403);
    expect(await started.text()).toContain('executor');

    const edited = await register(request, AUTHORED_WD, sessionCookieHeaders(callers.colleague));
    expect(edited.status(), await edited.text()).toBe(403);
  });

  test('granting executor is all it takes to let the colleague run it', async ({ request }) => {
    const callers = await ensureFixture(request);

    // The point of the whole feature: no per-workflow configuration pass, just
    // the role. Workspace-wide, so it reaches the next workflow too.
    const granted = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${callers.colleague.uid}/roles`,
      { headers: apiKeyHeaders(), data: { grants: [{ role: 'executor', workflowName: null }] } },
    );
    expect(granted.status(), await granted.text()).toBe(200);

    const started = await startRun(request, AUTHORED_WD, callers.colleague);
    expect(started.status(), await started.text()).toBe(201);

    // Still not an editor: the verbs are separate grants.
    const edited = await register(request, AUTHORED_WD, sessionCookieHeaders(callers.colleague));
    expect(edited.status(), await edited.text()).toBe(403);
  });

  test('restricting a verb by hand still admits the built-in role that carries it', async ({ request }) => {
    const callers = await ensureFixture(request);

    // What a demo workspace did: gate the workflow on one project role and
    // discover the workspace owner can no longer touch what they own.
    const gated = await request.put(accessUrl(AUTHORED_WD), {
      headers: apiKeyHeaders(),
      data: { access: { run: ['qa-lead'], edit: ['qa-lead'] } },
    });
    expect(gated.status(), await gated.text()).toBe(200);
    expect((await gated.json()) as { access: unknown }).toMatchObject({
      access: {
        run: ['executor', 'workflow-manager', 'qa-lead'],
        edit: ['editor', 'workflow-manager', 'qa-lead'],
      },
    });

    // The author holds `workflow-manager` on this workflow and nothing else,
    // so this passes only because the floor was applied to the stored row.
    const started = await startRun(request, AUTHORED_WD, callers.author);
    expect(started.status(), await started.text()).toBe(201);

    const restored = await request.put(accessUrl(AUTHORED_WD), {
      headers: apiKeyHeaders(),
      data: { access: DEFAULT_ACCESS },
    });
    expect(restored.status(), await restored.text()).toBe(200);
  });

  test('an unrestricted verb is left open rather than raised to the floor', async ({ request }) => {
    const callers = await ensureFixture(request);

    const opened = await request.put(accessUrl(AUTOMATED_WD), {
      headers: apiKeyHeaders(),
      data: { access: { run: [], edit: [] } },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    expect((await opened.json()) as { access: unknown }).toMatchObject({
      access: { run: [], edit: [] },
    });

    // AGENTS.md §12: a floor on an empty list would gate every workflow that
    // is open today, which is the one thing this must never do.
    const started = await startRun(request, AUTOMATED_WD, callers.colleague);
    expect(started.status(), await started.text()).toBe(201);
  });

  test('a workflow-manager can act on a step its author restricted to someone else', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);

    const started = await startRun(request, GATED_STEP_WD, callers.author);
    expect(started.status(), await started.text()).toBe(201);
    const { run } = (await started.json()) as { run: { id: string } };
    const taskId = await waitForActTask(request, run.id);

    // The `testse` case end to end: the step allows `engineer` and the author
    // holds only `workflow-manager` on this workflow, which is the whole point
    // of the role (ADR-0020).
    const claimed = await request.post(`/api/tasks/${taskId}/claim`, {
      headers: sessionCookieHeaders(callers.author),
    });
    expect(claimed.status(), await claimed.text()).toBe(200);
  });

  test('a workflow registered by automation stays open to every member', async ({ request }) => {
    const callers = await ensureFixture(request);

    const res = await readAccess(request, AUTOMATED_WD, callers.colleague);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()) as { access: unknown }).toMatchObject({
      access: { run: [], edit: [] },
    });

    // AGENTS.md §13: the CLI, imports and the seeded builtins keep producing
    // workflows anybody in the workspace can run and change.
    const started = await startRun(request, AUTOMATED_WD, callers.colleague);
    expect(started.status(), await started.text()).toBe(201);
  });
});

/**
 * The same feature on the one workspace nobody creates by hand.
 *
 * A personal workspace is bootstrapped by `GET /api/users/me`, not by
 * `createNamespace`, so its owner's `workflow-manager` has to be written on
 * that path — and for a while was written on neither: migration 0046 reached
 * the workspaces that already existed, and nothing reached the ones
 * bootstrapped after it ran. Its own describe block because the fixture is a
 * user with no workspace at all, which the org fixture above cannot express.
 */
test.describe('Personal workspace built-in access — API E2E', () => {
  const SOLO = {
    email: 'personal-manager@mediforce.dev',
    password: 'personalmanager123456',
  } as const;
  /** Registered by the API key, so nothing about this workflow grants anything. */
  const IMPORTED_WD = 'personal-manager-imported';

  test('the owner of a bootstrapped personal workspace can act on a step restricted to someone else', async ({
    request,
  }) => {
    const caller: UserCaller = {
      uid: await createTestUser(SOLO.email, SOLO.password, 'Personal Manager'),
      sessionCookie: await signInAndGetSessionCookie(SOLO.email, SOLO.password),
    };

    // The bootstrap itself — this is the write under test.
    const me = await request.get('/api/users/me', { headers: sessionCookieHeaders(caller) });
    expect(me.status(), await me.text()).toBe(200);
    const { namespaces } = (await me.json()) as {
      namespaces: Array<{ handle: string; type: string }>;
    };
    const personal = namespaces.find((namespace) => namespace.type === 'personal');
    if (personal === undefined) throw new Error('GET /api/users/me bootstrapped no personal workspace');
    const handle = personal.handle;

    const roster = await request.get(`/api/users/members?namespace=${handle}`, {
      headers: sessionCookieHeaders(caller),
    });
    expect(roster.status(), await roster.text()).toBe(200);
    const { members } = (await roster.json()) as {
      members: Array<{ uid: string; grants: Array<{ role: string; workflowName: string | null }> }>;
    };
    expect(members.find((member) => member.uid === caller.uid)?.grants).toContainEqual({
      role: 'workflow-manager',
      workflowName: null,
    });

    // What the grant is for. An imported workflow whose step names a role from
    // somebody else's deployment is gated by the step floor (ADR-0020), and
    // the API key that registered it granted its owner nothing — so this claim
    // passes on the workspace-wide grant or not at all.
    const registered = await request.post(`/api/workflow-definitions?namespace=${handle}`, {
      headers: apiKeyHeaders(),
      data: workflowNamed(IMPORTED_WD, ['engineer']),
    });
    expect(registered.status(), await registered.text()).toBe(201);

    const started = await request.post('/api/processes', {
      headers: sessionCookieHeaders(caller),
      data: {
        namespace: handle,
        definitionName: IMPORTED_WD,
        triggeredBy: 'default-access-journey',
        triggerName: 'Start',
      },
    });
    expect(started.status(), await started.text()).toBe(201);
    const { run } = (await started.json()) as { run: { id: string } };

    const taskId = await waitForActTask(request, run.id);
    const claimed = await request.post(`/api/tasks/${taskId}/claim`, {
      headers: sessionCookieHeaders(caller),
    });
    expect(claimed.status(), await claimed.text()).toBe(200);
  });
});
