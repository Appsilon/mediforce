---
name: e2e-test
description: Write and run L4 UI E2E journey tests. Use when implementing UI features (TDD red-green), adding tests for existing features, or when E2E tests need updating. Handles the workflow: write test → run → green.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
metadata:
  author: Appsilon
  version: "1.0"
  domain: testing
  complexity: intermediate
  tags: e2e, playwright, testing
---

# E2E Journey Tests

Full strategy: `docs/E2E-STRATEGY.md`

## When to Use

- Implementing a new UI feature (write test FIRST — TDD red-green)
- Adding test coverage for an existing feature
- Fixing a bug (write test that reproduces it, then fix)
- Updating tests after intentional UI changes

## Principles (must follow)

1. **One test per feature** — complete user flow, not element visibility checks
2. **Navigate like a user** — `page.goto()` only as entry point, then click links/buttons
3. **Complete the action** — click approve AND verify confirmation. Don't stop at "button visible"
4. **Isolate mutating tests** — tests that change state (cancel, approve, delete) must use dedicated seed data. Never mutate data other tests read
5. **Tests are protected** — never modify a test just to make CI green

## Writing a New Test

### 1. Create the file

```
packages/platform-ui/e2e/ui/<feature-name>.journey.ts
```

### 2. Template

```typescript
import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('<Feature> Journey', () => {
  test('<what the user does>', async ({ page }) => {
    trackPageErrors(page);

    // Entry point
    await page.goto(`/${TEST_ORG_HANDLE}/<path>`);
    await expect(page.getByRole('heading', { name: '<title>' })).toBeVisible({ timeout: 10_000 });

    // Navigate by clicking
    await page.getByText('<link text>').click();

    // Complete the action
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 15_000 });
  });
});
```

### 3. Key helpers

- `trackPageErrors(page)` — first line; collects page/console errors so you can assert none occurred via `getPageErrors(page)`
- `allowPageErrors(page, [...])` — filter out test-environment-only errors that cannot occur in production
- `{ timeout: 10_000 }` — on first assertion after page load

### 4. If test mutates state

Add dedicated seed data in `e2e/helpers/seed-data.ts`:

```typescript
// In buildSeedData():
'proc-my-feature-target': {
  id: 'proc-my-feature-target',
  // ... copy from similar instance, give unique ID
},
```

Use this dedicated instance in the test. Never mutate `proc-running-1` or other shared instances.

## Running

```bash
# Run single test while developing
pnpm test:e2e -- --grep "<test name>"

# Run all E2E
pnpm test:e2e
```

## After Test Passes

Commit the test file with the feature code in the same PR.

## Debugging Failures

- Use `agent-browser` on `localhost:9007` (the E2E server) to see what the UI shows
- Check Postgres is reachable: `psql "$DATABASE_URL" -c 'select 1'`
- Strict mode error → use `.first()` or more specific locator
- Auth issue → the `setup` project seeds `auth_users` + `auth_sessions`; re-run it
  (`pnpm test:e2e -- --project=setup`) and confirm `e2e/.auth/user.json` exists
