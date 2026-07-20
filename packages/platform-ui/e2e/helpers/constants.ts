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
