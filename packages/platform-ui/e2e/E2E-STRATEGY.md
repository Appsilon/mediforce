# E2E Testing Strategy

## Current State

87 tests across 9 files. Breakdown by type:

| Type | Count | What it does |
|------|-------|-------------|
| SMOKE | 37 | Checks element visibility — "heading exists", "button is visible" |
| FLOW | 27 | Clicks/tabs but doesn't complete any journey |
| DATA | 20 | Asserts CSS classes, badge text, data attributes |
| Full journey | 0 | No test completes a user flow with state change |

Problems:

- **Redundant navigation**: `process-run.spec.ts` navigates to the same URL 10 separate times, each checking one element. 10 page loads for 10 assertions.
- **No state verification**: Tests check "approve button is visible" but never click it to verify the task actually completes.
- **Brittle CSS assertions**: Tests like "step has `border-l-4 border-blue`" break on any Tailwind refactor without catching real bugs.
- **Slow for what they cover**: ~12min CI for tests that mostly check element existence.

## Target State

~12 journey tests + 2 smoke tests replacing 87 fragmented tests.

### Principles

1. **One navigation per test** — a journey test navigates to a page once and walks through the feature, asserting along the way.
2. **End with state change** — every journey test verifies that a user action changed something (task completed, run cancelled, definition saved), not just that a button exists.
3. **The test IS the spec** — reading the test tells you what the feature does. The GIF recording is the visual proof.
4. **No CSS class assertions** — test user-visible behavior, not Tailwind implementation details.

### Journey Tests

| Journey | Replaces | What it tests |
|---------|----------|--------------|
| `task-review.journey.ts` | my-tasks (11 tests) | Task list → grouping options → click task → see detail → see verdict buttons |
| `workflow-runs.journey.ts` | my-runs (8) + process-run (10) | Home → workflow cards with counts → click run → step graph → step history → audit log |
| `workflow-editor.journey.ts` | workflow-definitions (6) | Definition → diagram → edit mode → click node → add step → cancel discards |
| `run-report.journey.ts` | run-report (8) | Completed run → View Report → timeline → toggle brief/full → print button |
| `agent-oversight.journey.ts` | agent-oversight (9) + catalog (5) | Agents → plugin cards → Run History → autonomy badges → click run detail → model/confidence |
| `completed-run.journey.ts` | process-run (3) | Completed run → all steps completed → step history entries |
| `cancel-run.journey.ts` | process-run (3) | Running process → cancel → dismiss with "Keep running" → cancel again → confirm |
| `workflow-browse.journey.ts` | workflow-definitions (4) | Workflow detail → Runs/Definitions tabs → version → diagram |

### What stays

- `smoke.spec.ts` — 2 tests (login page loads, unauthenticated redirect). No emulators needed. Drop the 2 duplicate route-exists tests.

### What gets dropped entirely

- All pure CSS class assertions (`opacity-60`, `border-l-4 border-blue`, `font-medium`)
- `navigation.spec.ts` — absorbed into journey tests
- `[RENDER]`/`[CLICK]`/`[DATA]` tags — journey tests cover all categories by nature

## Recording Mode

For PR demos and visual verification. Not on every CI run.

### How it works

1. Playwright native video (`video: 'on'`) + `slowMo: 300ms` for human-readable speed
2. Post-process `.webm` → GIF via ffmpeg: `ffmpeg -i video.webm -vf "fps=10,scale=960:-1" -loop 0 output.gif`
3. Only journey tests get recorded (smoke tests are too trivial)

### Commands

| Command | Speed | When |
|---------|-------|------|
| `pnpm test:e2e` | Fast | Every PR — smoke only |
| `pnpm test:e2e:auth` | Fast | Every PR — smoke + journeys |
| `pnpm test:e2e:auth:headed` | Normal | Local dev — visible browser |
| `pnpm test:e2e:record` | Slow (3x) | Feature PRs — captures video |
| `pnpm test:e2e:gif` | Slow (3x) | Feature PRs — video → GIF |

### CI integration

- Normal CI: runs `test:e2e:auth` as today (fast)
- Recording: separate job gated on `record-e2e` PR label, runs after normal E2E passes
- GIF posted as PR comment via `gh pr comment`

## TDD Workflow

When building a new feature or fixing a bug:

### 1. Write journey test (RED)

```typescript
// e2e/journeys/retry-run.journey.ts
test('user retries a failed run', async ({ page }) => {
  await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-failed-1`);

  // Feature doesn't exist yet — these will fail
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  await page.getByRole('button', { name: /retry/i }).click();
  await expect(page.getByText(/new run started/i)).toBeVisible();
});
```

### 2. Update seed data if needed

Add fixtures to `seed-data.ts` for the new feature's data requirements.

### 3. Implement (GREEN)

Build the feature. Run `pnpm test:e2e:auth -- --grep "retry"` until green.

### 4. Record and attach to PR

```bash
pnpm test:e2e:gif -- --grep "retry"
# GIF lands in test-results/, attach to PR
```

## File Organization

```
e2e/
  auth-setup.ts
  smoke.spec.ts                     # 2 tests, no emulators
  helpers/
    constants.ts
    emulator.ts
    seed-data.ts
  journeys/                         # All journey tests
    task-review.journey.ts
    workflow-runs.journey.ts
    workflow-editor.journey.ts
    run-report.journey.ts
    agent-oversight.journey.ts
    completed-run.journey.ts
    cancel-run.journey.ts
    workflow-browse.journey.ts
```

## Migration Plan

Incremental, not big-bang:

1. Create `journeys/` folder with first journey test (e.g., `task-review.journey.ts`)
2. Verify it passes in CI
3. Delete corresponding tests from `authenticated/my-tasks.spec.ts`
4. Repeat per file
5. Delete `authenticated/` folder when empty

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Test count | 87 | ~12 |
| Page navigations | ~120 | ~12 |
| CI time (est.) | ~12min | ~6-8min |
| Full journeys tested | 0 | 8-10 |
| State changes verified | 0 | 8-10 |
