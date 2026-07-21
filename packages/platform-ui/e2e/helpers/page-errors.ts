import type { Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

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

/** Get page errors collected during the test. Empty array = no errors. */
export function getPageErrors(page: Page): string[] {
  return pageErrors.get(page) ?? [];
}
