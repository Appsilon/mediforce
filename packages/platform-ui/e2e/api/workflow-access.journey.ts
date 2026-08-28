import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import {
  backdatePostgresTriggerCursor,
  seedPostgresOrganizationNamespace,
} from '../helpers/postgres-seed';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  TEST_USER_ID,
  type UserCaller,
} from '../helpers/multi-namespace';

/**
 * API-level journey for the workflow `run` / `edit` gates (ADR-0019, issue
 * #1253), driven through real Postgres, real middleware and real session
 * cookies.
 *
 * Two things are under test, and the second matters more than the first.
 *
 * 1. The gates refuse and admit the right people. `run` covers starting a run;
 *    `edit` covers registering a version, archiving, deleting, transferring,
 *    setting visibility and moving the default version — none of which was
 *    gated by anything beyond workspace membership before this landed.
 * 2. **A workflow with no access rows behaves exactly as it did before.** That
 *    is what makes this deployable without a per-workspace configuration pass,
 *    and it is the regression a role gate causes silently and workspace-wide.
 *
 * Everything lives in a dedicated `access-gate-org` so no role holder is added
 * to the shared `test` workspace whose roster other journeys render.
 *
 * The file runs **serially**: its workflows and grants are one shared fixture,
 * and two workers registering or granting the same thing race — a
 * duplicate-version insert on the definition, mutual clobbering on the grant
 * (a role write is a full replace).
 */
const ORG_HANDLE = 'access-gate-org';
/** Transfer target — `edit` covers moving a workflow out of its workspace. */
const TRANSFER_TARGET_HANDLE = 'access-gate-org-2';

/** Gated on both verbs; the workflow every refusal test acts on. */
const GATED_WD = 'access-gated';
/** No access rows at all — the "nothing changed" control. */
const OPEN_WD = 'access-open';
/** Gated on `run`, and fired by cron, which must be unaffected. */
const CRON_WD = 'access-cron';

const RUN_ROLE = 'access-runner';
const EDIT_ROLE = 'access-editor';

interface Persona {
  readonly email: string;
  readonly password: string;
  readonly membership: 'member' | 'admin';
  readonly roles: readonly string[];
}

const PERSONAS = {
  /** Plain member holding nothing — refused both verbs on a gated workflow. */
  noRole: {
    email: 'access-gate-none@mediforce.dev',
    password: 'accessgatenone123456',
    membership: 'member',
    roles: [],
  },
  /** Holds `run` only: may start the workflow, may not change it. */
  runner: {
    email: 'access-gate-runner@mediforce.dev',
    password: 'accessgaterunner123456',
    membership: 'member',
    roles: [RUN_ROLE],
  },
  /** Holds `edit` only: may change the workflow, may not start it. */
  editor: {
    email: 'access-gate-editor@mediforce.dev',
    password: 'accessgateeditor123456',
    membership: 'member',
    roles: [EDIT_ROLE],
  },
  /** Admin holding neither role — administering access is a Membership privilege. */
  admin: {
    email: 'access-gate-admin@mediforce.dev',
    password: 'accessgateadmin123456',
    membership: 'admin',
    roles: [],
  },
} as const satisfies Record<string, Persona>;

type Callers = Record<keyof typeof PERSONAS, UserCaller>;

let fixture: Promise<Callers> | null = null;

function ensureFixture(request: APIRequestContext): Promise<Callers> {
  fixture ??= buildFixture(request);
  return fixture;
}

/** A one-step workflow with a manual trigger — enough to be startable. */
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

async function registerWorkflow(
  request: APIRequestContext,
  definition: Record<string, unknown>,
  namespace: string = ORG_HANDLE,
): Promise<void> {
  const name = definition.name as string;
  const existing = await request.get(
    `/api/workflow-definitions/${name}?namespace=${namespace}`,
    { headers: apiKeyHeaders() },
  );
  if (existing.status() === 200) return;

  const res = await request.post(`/api/workflow-definitions?namespace=${namespace}`, {
    headers: apiKeyHeaders(),
    data: definition,
  });
  expect(res.status(), await res.text()).toBe(201);
}

function accessUrl(name: string, namespace: string = ORG_HANDLE): string {
  return `/api/workflow-definitions/${encodeURIComponent(name)}/access?namespace=${namespace}`;
}

async function setAccess(
  request: APIRequestContext,
  name: string,
  access: { run: string[]; edit: string[] },
): Promise<void> {
  const res = await request.put(accessUrl(name), {
    headers: apiKeyHeaders(),
    data: { access },
  });
  expect(res.status(), await res.text()).toBe(200);
}

function startRun(request: APIRequestContext, workflowName: string, caller: UserCaller) {
  return request.post('/api/processes', {
    headers: sessionCookieHeaders(caller),
    data: {
      namespace: ORG_HANDLE,
      definitionName: workflowName,
      triggeredBy: 'access-gate-journey',
      triggerName: 'Start',
    },
  });
}

function archive(
  request: APIRequestContext,
  workflowName: string,
  caller: UserCaller,
  archived: boolean,
) {
  return request.post(
    `/api/workflow-definitions/${encodeURIComponent(workflowName)}/archive?namespace=${ORG_HANDLE}`,
    { headers: sessionCookieHeaders(caller), data: { archived } },
  );
}

async function buildFixture(request: APIRequestContext): Promise<Callers> {
  await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Access Gate Org');
  await seedPostgresOrganizationNamespace(
    TRANSFER_TARGET_HANDLE,
    TEST_USER_ID,
    'Access Gate Transfer Target',
  );

  await registerWorkflow(request, workflowNamed(GATED_WD));
  await registerWorkflow(request, workflowNamed(OPEN_WD));
  await registerWorkflow(request, workflowNamed(CRON_WD));

  await setAccess(request, GATED_WD, { run: [RUN_ROLE], edit: [EDIT_ROLE] });
  await setAccess(request, CRON_WD, { run: [RUN_ROLE], edit: [] });

  const callers = {} as Callers;
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const uid = await createTestUser(persona.email, persona.password, key);
    const invited = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: { email: persona.email, namespaceHandle: ORG_HANDLE, role: persona.membership },
    });
    expect(invited.status(), await invited.text()).toBe(201);

    const granted = await request.put(`/api/namespaces/${ORG_HANDLE}/members/${uid}/roles`, {
      headers: apiKeyHeaders(),
      data: { grants: persona.roles.map((role) => ({ role, workflowName: null })) },
    });
    expect(granted.status(), await granted.text()).toBe(200);

    callers[key as keyof typeof PERSONAS] = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(persona.email, persona.password),
    };
  }
  return callers;
}

test.describe.configure({ mode: 'serial' });

test.describe('Workflow run/edit access — API E2E', () => {
  test('a member holding no run role cannot start the workflow', async ({ request }) => {
    const callers = await ensureFixture(request);

    const res = await startRun(request, GATED_WD, callers.noRole);

    expect(res.status(), await res.text()).toBe(403);
    const { error } = (await res.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe('forbidden');
    expect(error.message).toContain(RUN_ROLE);
  });

  test('a holder of the run role starts it', async ({ request }) => {
    const callers = await ensureFixture(request);

    const res = await startRun(request, GATED_WD, callers.runner);

    expect(res.status(), await res.text()).toBe(201);
  });

  test('the run and edit verbs are separate grants, not one permission', async ({ request }) => {
    const callers = await ensureFixture(request);

    // The editor may change it but not start it...
    expect((await startRun(request, GATED_WD, callers.editor)).status()).toBe(403);
    const archived = await archive(request, GATED_WD, callers.editor, true);
    expect(archived.status(), await archived.text()).toBe(200);
    const restored = await archive(request, GATED_WD, callers.editor, false);
    expect(restored.status(), await restored.text()).toBe(200);

    // ...and the runner the other way round.
    expect((await archive(request, GATED_WD, callers.runner, true)).status()).toBe(403);
  });

  test('every mutation the edit verb covers refuses a non-holder', async ({ request }) => {
    const callers = await ensureFixture(request);
    const headers = sessionCookieHeaders(callers.noRole);
    const encoded = encodeURIComponent(GATED_WD);

    const register = await request.post(`/api/workflow-definitions?namespace=${ORG_HANDLE}`, {
      headers,
      data: workflowNamed(GATED_WD),
    });
    expect(register.status(), await register.text()).toBe(403);

    const archived = await archive(request, GATED_WD, callers.noRole, true);
    expect(archived.status(), await archived.text()).toBe(403);

    const visibility = await request.patch(
      `/api/workflow-definitions/${encoded}?namespace=${ORG_HANDLE}`,
      { headers, data: { visibility: 'public' } },
    );
    expect(visibility.status(), await visibility.text()).toBe(403);

    const defaultVersion = await request.post(
      `/api/workflow-definitions/${encoded}/default-version`,
      { headers, data: { namespace: ORG_HANDLE, version: 1 } },
    );
    expect(defaultVersion.status(), await defaultVersion.text()).toBe(403);

    const transfer = await request.post(`/api/workflow-definitions/${encoded}/transfer`, {
      headers,
      data: { sourceNamespace: ORG_HANDLE, targetNamespace: TRANSFER_TARGET_HANDLE },
    });
    expect(transfer.status(), await transfer.text()).toBe(403);

    // `expectedRunCount` has to be the real count: the race guard runs before
    // the role gate (a non-member's count reads 0, and keeping their 409 is
    // what stops the gate from turning into an existence oracle), so a stale
    // count here would be refused as a conflict and prove nothing about `edit`.
    const counted = await request.get(
      `/api/workflow-definitions/${encoded}/run-count?namespace=${ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    const { count } = (await counted.json()) as { count: number };
    const deleted = await request.delete(
      `/api/workflow-definitions/${encoded}?namespace=${ORG_HANDLE}`,
      { headers, data: { expectedRunCount: count } },
    );
    expect(deleted.status(), await deleted.text()).toBe(403);

    // None of that touched the workflow.
    const still = await request.get(
      `/api/workflow-definitions/${encoded}?namespace=${ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    expect(still.status()).toBe(200);
    const { definition } = (await still.json()) as {
      definition: { visibility: string; archived?: boolean };
    };
    expect(definition.visibility).toBe('private');
    expect(definition.archived).not.toBe(true);
  });

  test('a workflow with no access rows is unchanged for every verb', async ({ request }) => {
    const callers = await ensureFixture(request);

    // The same plain member refused everything above passes everything here.
    expect((await startRun(request, OPEN_WD, callers.noRole)).status()).toBe(201);
    const archived = await archive(request, OPEN_WD, callers.noRole, true);
    expect(archived.status(), await archived.text()).toBe(200);
    const restored = await archive(request, OPEN_WD, callers.noRole, false);
    expect(restored.status(), await restored.text()).toBe(200);

    const register = await request.post(`/api/workflow-definitions?namespace=${ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.noRole),
      data: workflowNamed(OPEN_WD),
    });
    expect(register.status(), await register.text()).toBe(201);

    const headers = sessionCookieHeaders(callers.noRole);
    const encoded = encodeURIComponent(OPEN_WD);

    const visibility = await request.patch(
      `/api/workflow-definitions/${encoded}?namespace=${ORG_HANDLE}`,
      { headers, data: { visibility: 'private' } },
    );
    expect(visibility.status(), await visibility.text()).toBe(200);

    const defaultVersion = await request.post(
      `/api/workflow-definitions/${encoded}/default-version`,
      { headers, data: { namespace: ORG_HANDLE, version: 1 } },
    );
    expect(defaultVersion.status(), await defaultVersion.text()).toBe(200);

    // Delete and transfer are destructive, so each gets its own throwaway
    // workflow rather than consuming the one the cases above share.
    const toDelete = `access-open-delete-${Date.now()}`;
    await registerWorkflow(request, workflowNamed(toDelete));
    const deleted = await request.delete(
      `/api/workflow-definitions/${encodeURIComponent(toDelete)}?namespace=${ORG_HANDLE}`,
      { headers, data: { expectedRunCount: 0 } },
    );
    expect(deleted.status(), await deleted.text()).toBe(200);

    const toTransfer = `access-open-transfer-${Date.now()}`;
    await registerWorkflow(request, workflowNamed(toTransfer));
    const transferred = await request.post(
      `/api/workflow-definitions/${encodeURIComponent(toTransfer)}/transfer`,
      {
        headers: apiKeyHeaders(),
        data: { sourceNamespace: ORG_HANDLE, targetNamespace: TRANSFER_TARGET_HANDLE },
      },
    );
    expect(transferred.status(), await transferred.text()).toBe(200);
  });

  test('a copy that stays in the workspace inherits the gate it was copied from', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);
    const copyName = `access-copy-${Date.now()}`;

    // Copying is not gated — refusing it would remove a capability
    // `visibility: public` exists to grant — so a member holding nothing does it.
    const copied = await request.post(
      `/api/workflow-definitions/${encodeURIComponent(GATED_WD)}/copy` +
        `?namespace=${ORG_HANDLE}&targetNamespace=${ORG_HANDLE}`,
      {
        headers: sessionCookieHeaders(callers.noRole),
        data: { targetName: copyName },
      },
    );
    expect(copied.status(), await copied.text()).toBe(201);

    // ...and the copy is gated exactly as its source was, or copy would be a
    // one-call bypass of the run gate.
    const readback = await request.get(accessUrl(copyName), { headers: apiKeyHeaders() });
    expect(((await readback.json()) as { access: unknown }).access).toEqual({
      run: [RUN_ROLE],
      edit: [EDIT_ROLE],
    });
    expect((await startRun(request, copyName, callers.noRole)).status()).toBe(403);
  });

  test('a cron trigger fires a run-gated workflow — the system actor holds no roles', async ({
    request,
  }) => {
    await ensureFixture(request);
    const triggerName = 'access-every-15m';

    const existing = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(CRON_WD)}/triggers?namespace=${ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    const { triggers } = (await existing.json()) as { triggers: Array<{ name: string }> };
    if (!triggers.some((trigger) => trigger.name === triggerName)) {
      const created = await request.post(
        `/api/workflow-definitions/${encodeURIComponent(CRON_WD)}/triggers`,
        {
          headers: apiKeyHeaders(),
          data: {
            namespace: ORG_HANDLE,
            triggerName,
            type: 'cron',
            schedule: '*/15 * * * *',
          },
        },
      );
      expect(created.ok(), await created.text()).toBe(true);
    }

    // A fresh cron row falls back to the definition's `createdAt`, which is
    // seconds old, so no 15-minute boundary is in the window and the tick reads
    // "Not due". The cursor is the only way to make one due inside a test.
    await backdatePostgresTriggerCursor(
      ORG_HANDLE,
      CRON_WD,
      triggerName,
      new Date(Date.now() - 60 * 60 * 1000),
    );

    const heartbeat = await request.post('/api/cron/heartbeat', { headers: apiKeyHeaders() });
    expect(heartbeat.status(), await heartbeat.text()).toBe(200);
    const body = (await heartbeat.json()) as {
      triggered: Array<{ definitionName: string }>;
      skipped: Array<{ definitionName: string; reason: string }>;
    };

    expect(body.triggered.some((fired) => fired.definitionName === CRON_WD)).toBe(true);
    expect(body.skipped.find((skip) => skip.definitionName === CRON_WD)).toBeUndefined();
  });

  test('the Access tab reads for any member and writes only for owner/admin', async ({
    request,
  }) => {
    const callers = await ensureFixture(request);

    // A plain member reads it — this screen is where they learn why Start is
    // disabled, so a 403 would answer that question with silence.
    const read = await request.get(accessUrl(GATED_WD), {
      headers: sessionCookieHeaders(callers.noRole),
    });
    expect(read.status(), await read.text()).toBe(200);
    const seen = (await read.json()) as {
      access: { run: string[]; edit: string[] };
      caller: { mayRun: boolean; mayEdit: boolean };
    };
    expect(seen.access).toEqual({ run: [RUN_ROLE], edit: [EDIT_ROLE] });
    expect(seen.caller).toEqual({ mayRun: false, mayEdit: false });

    // The same read, by someone who holds `run`, answers differently — the
    // verbs come from the predicate the gate enforces, not from the lists.
    const runnerRead = await request.get(accessUrl(GATED_WD), {
      headers: sessionCookieHeaders(callers.runner),
    });
    expect(((await runnerRead.json()) as { caller: unknown }).caller).toEqual({
      mayRun: true,
      mayEdit: false,
    });

    // Holding `edit` is not permission to rewrite who holds it.
    const memberWrite = await request.put(accessUrl(GATED_WD), {
      headers: sessionCookieHeaders(callers.editor),
      data: { access: { run: [], edit: [] } },
    });
    expect(memberWrite.status(), await memberWrite.text()).toBe(403);

    // An admin holding neither role administers both.
    const adminWrite = await request.put(accessUrl(OPEN_WD), {
      headers: sessionCookieHeaders(callers.admin),
      data: { access: { run: [RUN_ROLE], edit: [] } },
    });
    expect(adminWrite.status(), await adminWrite.text()).toBe(200);
    expect((await startRun(request, OPEN_WD, callers.noRole)).status()).toBe(403);

    // ...and clearing it puts the workflow back the way it was.
    const cleared = await request.put(accessUrl(OPEN_WD), {
      headers: sessionCookieHeaders(callers.admin),
      data: { access: { run: [], edit: [] } },
    });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect((await startRun(request, OPEN_WD, callers.noRole)).status()).toBe(201);
  });

  test('deleting a workflow takes its access with it', async ({ request }) => {
    await ensureFixture(request);
    const name = `access-cascade-${Date.now()}`;
    await registerWorkflow(request, workflowNamed(name));
    await setAccess(request, name, { run: [RUN_ROLE], edit: [] });

    const deleted = await request.delete(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${ORG_HANDLE}`,
      { headers: apiKeyHeaders(), data: { expectedRunCount: 0 } },
    );
    expect(deleted.status(), await deleted.text()).toBe(200);

    // The name is gone, so its gate has to be too: whoever registers it next
    // must not silently inherit a restriction nobody configured for them.
    const readback = await request.get(accessUrl(name), { headers: apiKeyHeaders() });
    expect(readback.status(), await readback.text()).toBe(200);
    expect(((await readback.json()) as { access: unknown }).access).toEqual({ run: [], edit: [] });
  });
});
