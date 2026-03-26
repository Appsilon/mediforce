---
name: e2e-test
description: Write, run, and record E2E journey tests. Use when implementing UI features (TDD red-green), adding tests for existing features, or when E2E tests need updating. Handles the full workflow: write test → run → record GIF → update gallery.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
metadata:
  author: Appsilon
  version: "1.0"
  domain: testing
  complexity: intermediate
  tags: e2e, playwright, testing, recording, gif
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
packages/platform-ui/e2e/journeys/<feature-name>.journey.ts
```

### 2. Template

```typescript
import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('<Feature> Journey', () => {
  test('<what the user does>', async ({ page }, testInfo) => {
    await setupRecording(page, '<gif-name>', testInfo);

    // Entry point
    await page.goto(`/${TEST_ORG_HANDLE}/<path>`);
    await expect(page.getByRole('heading', { name: '<title>' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Navigate by clicking
    await click(page, page.getByText('<link text>'));
    await showStep(page);

    // Complete the action
    await click(page, page.getByRole('button', { name: /submit/i }));
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 15_000 });
    await showResult(page);

    await endRecording(page);
  });
});
```

### 3. Key helpers

- `setupRecording(page, 'gif-name', testInfo)` — first line, names the GIF
- `click(page, locator)` — use instead of `locator.click()` (shows cursor in recordings)
- `showStep(page)` — 1.5s pause at intermediate steps (recording only)
- `showResult(page)` — 2.5s pause at key outcomes (recording only)
- `endRecording(page)` — last line, moves cursor to center for seamless GIF loop
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
cd packages/platform-ui
pnpm test:e2e:auth -- --grep "<test name>"

# Run all E2E
pnpm test:e2e:auth

# Record + convert to GIFs
pnpm test:e2e:gif
```

## After Test Passes

1. **Record**: `pnpm test:e2e:gif`
2. **Update gallery**: add entry to `docs/features/FEATURES.md`
3. **Commit**: GIF + FEATURES.md + test file in same PR

## Debugging Failures

- Use `agent-browser` on `localhost:9007` (emulator mode) to see what the UI shows
- Check emulators running: `curl -s http://127.0.0.1:9099` and `:8080`
- Start emulators: `pnpm emulators`
- Strict mode error → use `.first()` or more specific locator
- Auth issue → re-run (flaky emulator state, CI retries handle this)
