import type { Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();
const allowedPageErrors = new WeakMap<Page, string[]>();

/**
 * Track page errors (React violations, unhandled exceptions, console errors)
 * for the current test. Call at the start of each test, then assert on
 * `getPageErrors(page)` at the end.
 */
export function trackPageErrors(page: Page): void {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Download the React DevTools')) {
      errors.push(msg.text());
    }
  });
}

/**
 * Allow specific page/console errors for the current test. Any collected error
 * whose text contains one of `substrings` is filtered out of `getPageErrors`.
 * Use sparingly — only for errors that are an artifact of the test environment
 * and provably cannot occur in production.
 */
export function allowPageErrors(page: Page, substrings: string[]): void {
  allowedPageErrors.set(page, substrings);
}

/** Get page errors collected during the test, minus any allowed via
 *  `allowPageErrors`. Empty array = no errors. */
export function getPageErrors(page: Page): string[] {
  const errors = pageErrors.get(page) ?? [];
  const allowed = allowedPageErrors.get(page) ?? [];
  if (allowed.length === 0) return errors;
  return errors.filter((err) => !allowed.some((s) => err.includes(s)));
}
