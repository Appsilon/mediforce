import type { UserDirectoryService } from '@mediforce/platform-core';

/**
 * A `UserDirectoryService` that answers nothing, with the parts a test cares
 * about overridden. Most handler tests need exactly one method — usually
 * `getUserMetadata` — and would otherwise re-declare the other five as
 * `async () => []` in every file, which then all have to be edited whenever
 * the port grows (as ADR-0019 just made it).
 *
 * The defaults are the empty answer, never a throw: a test that reaches an
 * unstubbed method is exercising a path it did not mean to assert on, and an
 * empty directory is the honest shape of that.
 */
export function stubUserDirectory(
  overrides: Partial<UserDirectoryService> = {},
): UserDirectoryService {
  return {
    async getUsersByRoleInNamespace() {
      return [];
    },
    async getRolesForUser() {
      return [];
    },
    async setRolesForUser() {
      // no-op
    },
    async clearRolesForWorkflow() {
      // no-op
    },
    async getRolesInNamespace() {
      return [];
    },
    async getUserMetadata() {
      return null;
    },
    ...overrides,
  };
}
