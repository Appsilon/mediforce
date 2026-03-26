# E2E Testing Strategy

## Principles

1. **One test per feature** — a journey test clicks through a complete user flow, across as many pages as needed. No splitting one flow into 10 separate tests.
2. **Navigate like a user** — use `page.goto()` only as the entry point (first page of the test). All subsequent navigation must use clicks on links and buttons — the same way a real user would navigate. This produces realistic recordings and catches broken links.
3. **Complete the action** — every journey test must finish what it starts. If the feature has an approve button, click it and verify the result. If there's a form, fill it and submit. Don't stop at "button is visible".
4. **The test IS the spec** — reading the test tells you what the feature does. The GIF recording is the visual proof.
5. **Assert what the user sees, not how it's styled** — checking that a badge says "failed" and looks red is good. Checking that a div has `border-l-4 border-blue-500` is brittle — it breaks on any Tailwind refactor without catching real bugs.
6. **Tests are protected** — E2E tests define expected behavior. Modifying a test to make it pass is only allowed when the feature itself intentionally changed. See [Modifying Existing Tests](#modifying-existing-tests).
7. **Isolate mutating tests** — tests that change state (cancel run, approve task, delete) must use their own dedicated seed data instance. Never mutate an instance that other tests read. Add new entries in `seed-data.ts` for each mutating test.

## Test Types

| Type | Location | Purpose |
|------|----------|---------|
| Smoke | `e2e/smoke.spec.ts` | Login page, auth redirect — no emulators needed |
| Journey | `e2e/journeys/*.journey.ts` | Full feature flows with state verification |

## File Organization

```
e2e/
  auth-setup.ts
  smoke.spec.ts
  helpers/
    constants.ts
    emulator.ts
    seed-data.ts
    recording.ts        # cursor, click, showStep, showResult, endRecording
  journeys/
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
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test('reviewer approves a human task', async ({ page }) => {
  await setupRecording(page);

  // Entry point — only page.goto allowed here
  await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
  await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 10_000 });
  await showStep(page);

  // Navigate by clicking — like a real user
  await click(page, page.getByText('Review Intake Data'));
  await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
  await showStep(page);

  // Complete the action — don't just check the button exists
  await click(page, page.getByRole('button', { name: /approve/i }));
  await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 15_000 });
  await showResult(page);

  await endRecording(page);
});
```

Key patterns:
- `setupRecording(page)` — first line of every test
- `click(page, locator)` — use instead of `locator.click()` for visible cursor movement in recordings
- `showStep(page)` — 1.5s pause at intermediate steps (only during recording)
- `showResult(page)` — 2.5s pause at key outcomes (only during recording)
- `endRecording(page)` — last line, moves cursor to center for seamless GIF loop
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
3. **Record** — `cd packages/platform-ui && pnpm test:e2e:gif`
4. **PR** — Commit the GIF to `docs/features/` and update `FEATURES.md`.

## PR Checklist

Every PR that touches UI must include in its description:

```markdown
## E2E Coverage
- **Added/updated tests**: list journey tests that changed
- **What they verify**: describe the user flow tested
- **Not covered**: list what is NOT tested by E2E and why
- **GIFs**: link to updated GIFs in docs/features/
```

## Commands

| Command | Speed | When |
|---------|-------|------|
| `pnpm test:e2e` | Fast | Every PR — smoke only |
| `pnpm test:e2e:auth` | ~40s | Every PR — smoke + journeys |
| `pnpm test:e2e:auth:headed` | Normal | Local dev — visible browser |
| `pnpm test:e2e:record` | ~3min | Feature PRs — captures video |
| `pnpm test:e2e:gif` | ~3min | Feature PRs — video + GIF |
| `pnpm test:e2e:check-gifs` | <1s | Check GIF freshness locally |

## Recording Mode

For feature documentation and PR demos. Not on every CI run.

- `channel: 'chromium'` for recording — uses full browser binary so position:fixed DOM elements render in video
- `slowMo: 500ms` for human-readable interaction speed
- CSS cursor arrow + click ripple injected via `page.evaluate` (see `helpers/recording.ts`)
- Post-process `.webm` to GIF via `scripts/e2e-to-gif.py` — auto-trims loading screens, two-pass palettegen
- Timeout increased to 120s during recording (pauses add time)

## Feature Gallery

Every journey test produces a GIF recording that lives in `docs/features/`. The gallery at [`docs/features/FEATURES.md`](../features/FEATURES.md) is the visual index of what the app does.

### Adding to the gallery

1. Record + convert: `cd packages/platform-ui && pnpm test:e2e:gif`
2. Add entry to `docs/features/FEATURES.md` under the right section with description and `![name](name.gif)`
3. Commit the GIF and FEATURES.md with the PR

### Debugging failed E2E tests

Use `agent-browser` skill to interact with the app on `localhost:9007` (emulator mode) or `localhost:9003` (dev mode) to understand what the UI shows and why a test fails.
