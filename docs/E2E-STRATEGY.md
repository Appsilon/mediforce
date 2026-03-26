# E2E Testing Strategy

## Principles

1. **One test per feature** — a journey test clicks through a complete user flow, across as many pages as needed. No splitting one flow into 10 separate tests.
2. **End with state change** — every journey test verifies that a user action changed something (task completed, run cancelled, definition saved), not just that a button exists.
3. **The test IS the spec** — reading the test tells you what the feature does. The GIF recording is the visual proof.
4. **Assert what the user sees, not how it's styled** — checking that a badge says "failed" and looks red is good. Checking that a div has `border-l-4 border-blue-500` is brittle — it breaks on any Tailwind refactor without catching real bugs.
5. **Tests are protected** — E2E tests define expected behavior. Modifying a test to make it pass is only allowed when the feature itself intentionally changed. See [Modifying Existing Tests](#modifying-existing-tests).

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
  journeys/
    task-review.journey.ts
    workflow-runs.journey.ts
    workflow-editor.journey.ts
    run-report.journey.ts
    agent-oversight.journey.ts
    cancel-run.journey.ts
    ...
```

## Writing a Journey Test

A journey test covers one feature or use case end-to-end. Example:

```typescript
test('reviewer approves a human task', async ({ page }) => {
  await page.goto(`/${TEST_ORG_HANDLE}/tasks`);

  await page.getByText('Review Intake Data').click();
  await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
  await page.getByRole('button', { name: /approve/i }).click();

  await expect(page.getByText(/completed/i)).toBeVisible();
});
```

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
3. **Record** — Run `pnpm test:e2e:gif -- --grep "<feature>"` to capture a GIF.
4. **PR** — Commit the GIF to `docs/features/` and update `docs/features/FEATURES.md`.

## Commands

| Command | Speed | When |
|---------|-------|------|
| `pnpm test:e2e` | Fast | Every PR — smoke only |
| `pnpm test:e2e:auth` | Fast | Every PR — smoke + journeys |
| `pnpm test:e2e:auth:headed` | Normal | Local dev — visible browser |
| `pnpm test:e2e:record` | Slow (3x) | Feature PRs — captures video |
| `pnpm test:e2e:gif` | Slow (3x) | Feature PRs — video + GIF |

## Recording Mode

For feature documentation and PR demos. Not on every CI run.

- Playwright native video (`video: 'on'`) + `slowMo: 300ms` for human-readable speed
- Post-process `.webm` to GIF via ffmpeg: `ffmpeg -i video.webm -vf "fps=10,scale=960:-1" -loop 0 output.gif`
- Only journey tests get recorded

## Feature Gallery

Every journey test produces a GIF recording that lives in `docs/features/`. The gallery at [`docs/features/FEATURES.md`](../features/FEATURES.md) is the visual index of what the app does — grouped by feature area with inline GIFs.

### Adding to the gallery

Use the `/e2e-record` skill, or manually:

1. Record: `pnpm test:e2e:record -- --grep "<feature>"`
2. Convert: `ffmpeg -y -i <video.webm> -vf "fps=10,scale=960:-1:flags=lanczos" -loop 0 docs/features/<name>.gif`
3. Add entry to `docs/features/FEATURES.md` under the right section with description and `![name](name.gif)`
4. Add the GIF filename to the summary table at the top of FEATURES.md
5. Commit the GIF and FEATURES.md with the PR
