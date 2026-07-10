# E2E Testing Strategy

## Principles

1. **One test per feature** — a journey test clicks through a complete user flow, across as many pages as needed. No splitting one flow into 10 separate tests.
2. **Navigate like a user** — use `page.goto()` only as the entry point (first page of the test). All subsequent navigation must use clicks on links and buttons — the same way a real user would navigate. This catches broken links.
3. **Complete the action** — every journey test must finish what it starts. If the feature has an approve button, click it and verify the result. If there's a form, fill it and submit. Don't stop at "button is visible".
4. **The test IS the spec** — reading the test tells you what the feature does.
5. **Assert what the user sees, not how it's styled** — checking that a badge says "failed" and looks red is good. Checking that a div has `border-l-4 border-blue-500` is brittle — it breaks on any Tailwind refactor without catching real bugs.
6. **Tests are protected** — E2E tests define expected behavior. Modifying a test to make it pass is only allowed when the feature itself intentionally changed. See [Modifying Existing Tests](#modifying-existing-tests).
7. **Isolate mutating tests** — tests that change state (cancel run, approve task, delete) must use their own dedicated seed data instance. Never mutate an instance that other tests read. Add new entries in `seed-data.ts` for each mutating test.

## Parallel Execution & Data Isolation

Tests run with `fullyParallel: true`. This is safe because:

- **Read-only tests** share seed data freely — multiple tests can read the same workflow instance, task, or agent definition without conflict.
- **Mutating tests** (cancel run, approve task) each get a **dedicated seed data instance** in `seed-data.ts` (e.g., `proc-cancel-target`). No other test reads from or writes to that instance.
- **Fresh Firestore emulator** is seeded once per test run via `auth-setup.ts`. Tests don't create or delete data — they only read shared fixtures or mutate their isolated ones.

When adding a new test that **changes state**, create a new dedicated entry in `seed-data.ts` with a unique ID. Document which test owns it with a comment. Never mutate an instance that read-only tests depend on.

## Retry-Safe State Cleanup

`auth-setup.ts` runs **once per CI invocation**, not once per test. Playwright retries (`retries: 2` on CI) re-run the failing test against the **same Firestore state** the previous attempt left behind. If a test creates or mutates state that survives in Firestore — and the assertion that catches the change comes after the mutation — every retry will see the post-mutation state and fail in a way that looks unrelated to the original cause.

This is a fixture leak across retries. It surfaces as: first run fails for the real reason, retries time out on a setup precondition because the state is no longer pristine.

**Rule:** any journey that writes to Firestore beyond what `auth-setup.ts` seeded must explicitly clean that state at the *start* of the test. Use the `deleteDocument` / `clearEmulators` helpers from `e2e/helpers/emulator.ts`. Do this even when the happy path of the test would clean up at the end — retries don't reach the end.

Examples of state that needs explicit reset at test start:

- OAuth tokens written by callback handlers (`agentOAuthTokens/*`)
- Documents the test inserts via the UI (uploads, new agents, new bindings)
- Anything else not present in `auth-setup.ts` seed

Rule of thumb: if the test's first assertion would fail when run twice in a row against the same emulator, it has a fixture leak. Fix it with an explicit reset at the top, not by tightening selectors or bumping timeouts.

## Test Types

| Type | Location | Purpose |
|------|----------|---------|
| Smoke | `e2e/smoke.spec.ts` | Login page, auth redirect — no emulators needed |
| Journey | `e2e/ui/*.journey.ts` | Full feature flows with state verification |

## File Organization

```
e2e/
  auth-setup.ts
  smoke.spec.ts
  helpers/
    constants.ts
    emulator.ts
    seed-data.ts
    page-errors.ts      # trackPageErrors, allowPageErrors, getPageErrors
  ui/
    task-review.journey.ts
    workflow-home.journey.ts
    run-detail.journey.ts
    cancel-run.journey.ts
    run-report.journey.ts
    workflow-editor.journey.ts
    agent-oversight.journey.ts
```

## Writing a Journey Test

A journey test covers one feature or use case end-to-end. Example:

```typescript
import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test('reviewer approves a human task', async ({ page }) => {
  trackPageErrors(page);

  // Entry point — only page.goto allowed here
  await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
  await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 10_000 });

  // Navigate by clicking — like a real user
  await page.getByText('Review Intake Data').click();
  await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();

  // Complete the action — don't just check the button exists
  await page.getByRole('button', { name: /approve/i }).click();
  await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 15_000 });
});
```

Key patterns:
- `trackPageErrors(page)` — first line of every test; collects page/console errors so the test can assert none occurred via `getPageErrors(page)`
- `page.goto` — entry point only, then click links/buttons to navigate
- `{ timeout: 10_000 }` — on first assertion after page load (data may still be fetching)

When adding a new feature or fixing a bug, write or update the journey test that covers it. Update `seed-data.ts` if new Firestore fixtures are needed.

## Modifying Existing Tests

E2E tests are the source of truth for expected behavior. **Do not modify a test just to make CI green.**

When an E2E test fails, the correct response is:

1. **Fix the code** — the test caught a regression. Fix the bug, not the test.
2. **Only modify the test if the feature intentionally changed** — e.g., a button was renamed, a flow was redesigned, a page was removed.

When modifying a test IS justified, the agent MUST:
- State explicitly in the PR description: "E2E test `<name>` updated because `<what changed and why>`"
- Never silently adjust assertions, selectors, or expected values
- Never weaken a test (e.g., removing an assertion, loosening a check) without explicit approval

If you're unsure whether the test or the code is wrong — ask. Don't guess.

## TDD Workflow

1. **RED** — Write the journey test first. It describes the expected behavior. It fails because the feature doesn't exist yet.
2. **GREEN** — Implement until the test passes.
3. **PR** — Commit the test with the feature code.

## PR Checklist

Every PR that touches UI must include in its description:

```markdown
## E2E Coverage
- **Added/updated tests**: list journey tests that changed
- **What they verify**: describe the user flow tested
- **Not covered**: list what is NOT tested by E2E and why
```

## Commands

| Command | Speed | When |
|---------|-------|------|
| `pnpm test:e2e` | ~4min | Every PR — all E2E (smoke + L3 API + L4 UI) |
| `pnpm test:e2e:api` | ~30s | L3 only — API E2E, no browser |
| `pnpm test:e2e:ui` | ~3min | L4 only — UI E2E with real Chromium |
| `pnpm test:e2e:headed` (in `packages/platform-ui`) | Normal | Local dev — visible browser |

## Debugging Failed E2E Tests

Use `agent-browser` skill to interact with the app on `localhost:9007` (emulator mode) or `localhost:9003` (dev mode) to understand what the UI shows and why a test fails.
