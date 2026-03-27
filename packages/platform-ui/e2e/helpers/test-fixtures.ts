import { test as base, expect } from '@playwright/test';
import { getPageErrors } from './recording';

/**
 * Custom test fixture that asserts no unexpected page errors after each test.
 * Journey tests should import { test, expect } from this file instead of @playwright/test.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);

    // After each test: fail if page had JS errors (React violations, unhandled exceptions)
    const errors = getPageErrors(page);
    if (errors.length > 0) {
      throw new Error(
        `Page had ${errors.length} error(s) during test:\n${errors.map((e) => `  • ${e}`).join('\n')}`,
      );
    }
  },
});

export { expect };
