/**
 * The namespace handle used by the test user in E2E seeds.
 *
 * Despite the name, this workspace is seeded as **personal** (`type: 'personal'`,
 * `linkedUserId: testUserId` — see `seed-data.ts`), not an organization. A
 * journey that needs organization-only behaviour (branding: icon / logo / brand
 * colors) must seed its own org via `seedPostgresOrganizationNamespace` instead
 * of borrowing this handle.
 */
export const TEST_ORG_HANDLE = 'test';

/**
 * Stable id for the shared auth-setup test user (ADR-0002 §7 keep-uid model).
 * `auth-setup` seeds `auth_users`, `workspace_members`, and the session under
 * this id, so any journey that re-derives the test user's uid uses the same
 * constant instead of decoding it from a token.
 */
export const TEST_USER_ID = 'e2e-test-user';

/**
 * Credentials for that same shared user. They live here, next to the id, so no
 * caller re-declares the email on its own: `auth_users.email` is unique, so two
 * seeding paths spelling out the same literal while disagreeing about the id is
 * how the fixture ends up unseedable.
 */
export const TEST_USER_EMAIL = 'test@mediforce.dev';
export const TEST_USER_PASSWORD = 'test123456';
export const TEST_USER_DISPLAY_NAME = 'Test User';
