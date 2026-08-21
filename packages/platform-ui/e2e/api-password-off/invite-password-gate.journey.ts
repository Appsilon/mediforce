import { test, expect } from '../helpers/test-fixtures';
import { TEST_USER_ID } from '../helpers/constants';
import { deleteAuthUser } from '../helpers/emulator';
import { apiKeyHeaders } from '../helpers/multi-namespace';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';

/**
 * L3 API E2E for the invite flow on a deployment with password auth OFF
 * (`ENABLE_PASSWORD_AUTH=false`) — the surface issue #1109 is about.
 *
 * Runs against the second Playwright web server (`api-password-off` project,
 * see playwright.config.ts): whether password auth is on is resolved from the
 * environment at process start, so the password-off deployment is a different
 * server, not a different request. Everything else — database, build, fixtures
 * — is shared with the primary `api` project.
 *
 * The dead end being covered: an invitee on a Google/OIDC-only estate was
 * flagged `mustChangePassword`, bounced to `/change-password`, and set a
 * password that `/api/auth/password-login` (404 on this deployment) would never
 * accept. This journey walks the real HTTP path an invited user takes and
 * asserts the gate is never armed and the credential write is refused.
 *
 * A dedicated organization workspace keeps the invitee out of the shared `test`
 * workspace's member list, and the auth user is dropped up front so a Playwright
 * retry re-seeds from a clean slate instead of finding a half-activated account.
 */
const INVITE_WORKSPACE = 'password-off-invites';
const INVITEE_EMAIL = 'invitee-password-off@mediforce.dev';

interface MeResponse {
  user: { uid: string; mustChangePassword: boolean; hasPassword: boolean };
  namespaces: Array<{ handle: string; role: string }>;
}

test.describe('invite flow with ENABLE_PASSWORD_AUTH=false — API E2E', () => {
  test.beforeAll(async () => {
    await seedPostgresOrganizationNamespace(
      INVITE_WORKSPACE,
      TEST_USER_ID,
      'Password-Off Invites',
    );
    await deleteAuthUser(INVITEE_EMAIL);
  });

  test('an invited user is never gated into create-password, and cannot set one', async ({
    request,
  }) => {
    const inviteRes = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: {
        email: INVITEE_EMAIL,
        displayName: 'Password Off Invitee',
        namespaceHandle: INVITE_WORKSPACE,
        role: 'member',
      },
    });
    expect(inviteRes.status(), await inviteRes.text()).toBe(201);
    const invited = (await inviteRes.json()) as { uid: string; isExisting: boolean };
    expect(invited.isExisting).toBe(false);

    // The flag the `(app)` layout redirect reads. `false` here is what sends the
    // invitee to /workspace-selection instead of the /change-password page they
    // could never complete — the whole point of the fix.
    const meRes = await request.get(`/api/users/me?uid=${invited.uid}`, {
      headers: apiKeyHeaders(),
    });
    expect(meRes.status(), await meRes.text()).toBe(200);
    const me = (await meRes.json()) as MeResponse;
    expect(me.user.mustChangePassword).toBe(false);
    expect(me.user.hasPassword).toBe(false);
    expect(me.namespaces.map((n) => n.handle)).toContain(INVITE_WORKSPACE);

    // Closing the router entry point is not enough — the CLI and any apiKey
    // caller can still reach the handler, and a stored hash no sign-in route
    // accepts is worse than no hash.
    const setPasswordRes = await request.post('/api/users/set-password', {
      headers: apiKeyHeaders(),
      data: { uid: invited.uid, newPassword: 'a-password-nobody-can-use' },
    });
    expect(setPasswordRes.status(), await setPasswordRes.text()).toBe(409);
    const error = (await setPasswordRes.json()) as { error: { code: string; message: string } };
    expect(error.error.code).toBe('precondition_failed');
    expect(error.error.message).toMatch(/password auth/i);

    // The refusal wrote nothing.
    const afterRes = await request.get(`/api/users/me?uid=${invited.uid}`, {
      headers: apiKeyHeaders(),
    });
    const after = (await afterRes.json()) as MeResponse;
    expect(after.user.hasPassword).toBe(false);
  });
});
