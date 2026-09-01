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

function workflowNamed(name: string): Record<string, unknown> {
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
) {
  return request.post(`/api/workflow-definitions?namespace=${ORG_HANDLE}`, {
    headers,
    data: workflowNamed(name),
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
): Promise<void> {
  const existing = await request.get(
    `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${ORG_HANDLE}`,
    { headers: apiKeyHeaders() },
  );
  if (existing.status() === 200) return;
  const res = await register(request, name, headers);
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
