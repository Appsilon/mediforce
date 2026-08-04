import type { Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();
const allowedPatterns = new WeakMap<Page, (string | RegExp)[]>();

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
 * Declare page errors this test expects, so they stop counting as failures.
 * A journey that deliberately provokes a rejection asserts on the message the
 * UI renders, but the browser also logs the failed request to the console —
 * without this, covering a negative path would mean giving up error tracking
 * for the whole test.
 */
export function allowPageErrors(page: Page, patterns: (string | RegExp)[]): void {
  allowedPatterns.set(page, [...(allowedPatterns.get(page) ?? []), ...patterns]);
}

/** Get page errors collected during the test, minus the expected ones. */
export function getPageErrors(page: Page): string[] {
  const allowed = allowedPatterns.get(page) ?? [];
  return (pageErrors.get(page) ?? []).filter(
    (error) =>
      !allowed.some((pattern) =>
        typeof pattern === 'string' ? error.includes(pattern) : pattern.test(error),
      ),
  );
}
