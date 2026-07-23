/** The namespace handle used by the test user in E2E seeds */
export const TEST_ORG_HANDLE = 'test';

/**
 * Stable id for the shared auth-setup test user (ADR-0002 §7 keep-uid model).
 * `auth-setup` seeds `auth_users`, `workspace_members`, and the session under
 * this id, so any journey that re-derives the test user's uid uses the same
 * constant instead of decoding it from a token.
 */
export const TEST_USER_ID = 'e2e-test-user';
