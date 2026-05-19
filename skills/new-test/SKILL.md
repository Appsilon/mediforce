---
name: new-test
description: Write a new test for a feature, endpoint, handler, or pure function. Use when adding test coverage for new or changed code, or when starting a feature TDD-style (RED → GREEN). Triggers include "write a test for", "add unit test", "add integration test", "add API E2E", "TDD this", "red-green this", "cover X with a test", "test plan for". Decides the right level (L1 unit / L2 integration / L3 API E2E / L4 UI E2E / L5 external), scaffolds the file, and walks the RED-GREEN loop. Use `/e2e-test` instead for the L4 UI journey + GIF workflow.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
metadata:
  author: Mediforce
  version: "1.0"
  domain: development
  complexity: intermediate
  tags: testing, tdd, vitest, playwright, red-green
---

# New Test

One entry point for adding a test. **Always pick the lowest level that gives real signal.**

## Step 1 — Pick the level

| L | Name             | Runner     | Add when                                                                 |
|---|------------------|------------|--------------------------------------------------------------------------|
| 1 | Unit             | vitest     | Pure function, no I/O. Fastest signal — use whenever possible.           |
| 2 | Integration      | vitest     | Multi-component logic; route handlers wired to fake services.            |
| 3 | API E2E          | Playwright | **Every new endpoint or handler.** Proves Firestore + middleware + auth. |
| 4 | UI E2E           | Playwright | A real multi-step user journey in the browser. Sparse. Use `/e2e-test`.  |
| 5 | External / Tier 2| vitest     | Touching `agent-runtime`, `mcp-client`, or LLM-provider code.            |

**Rule of thumb:** every feature MUST be covered at **L3** (foundation). L1/L2 add logic coverage. L4 is for the journey only, not edge cases. L5 is opt-in and costs cents per run.

**For a new endpoint or handler, start at L3 directly.** L1/L2 are layers on top of the proven wiring, not replacements for it. Skipping L3 leaves the real Firestore + middleware + auth path untested.

## Step 2 — Scaffold

### L1 — Unit (vitest, co-located)

Location: `<source-file-dir>/__tests__/<name>.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fnUnderTest } from '../fnUnderTest';

describe('fnUnderTest', () => {
  it('returns Y for X', () => {
    expect(fnUnderTest('X')).toBe('Y');
  });
});
```

Run: `npx vitest run path/to/file.test.ts`

### L2 — Integration (vitest, in-process handler)

Location: `packages/platform-ui/src/test/integration/<feature>.test.ts`

Import route handlers directly, mock `getPlatformServices()` with in-memory fakes. Does NOT hit Firestore or middleware — claim "API works" only with an L3 alongside.

```ts
import * as route from '@/app/api/<...>/route';
import { makeInMemoryServices } from '@/test/helpers/in-memory-services';

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => makeInMemoryServices(),
}));

it('POST creates the resource', async () => {
  const req = new Request('http://x/api/...', { method: 'POST', body: '...' });
  const res = await route.POST(req);
  expect(res.status).toBe(201);
});
```

### L3 — API E2E (Playwright, real server + emulators)

Location: `packages/platform-ui/e2e/api/<feature>.spec.ts`. Use the `request` fixture only — **no `page`**.

```ts
import { test, expect } from '@playwright/test';

test('creates and lists resource', async ({ request }) => {
  const create = await request.post('/api/things', { data: { name: 'x' } });
  expect(create.ok()).toBe(true);

  const list = await request.get('/api/things');
  expect(await list.json()).toContainEqual(expect.objectContaining({ name: 'x' }));
});
```

Bootstrap once per machine: `python3 packages/platform-ui/scripts/bootstrap_e2e.py`. Real Next server, Firebase emulators, `MOCK_AGENT=true`. Runs serial (single `MEDIFORCE_DATA_DIR`).

### L4 — UI E2E

**Use `/e2e-test` instead.** UI E2E ships a GIF + gallery entry as part of the deliverable. This skill does not handle the recording workflow.

Reminder before reaching for L4: a UI E2E is a real multi-step user journey (click → fill → navigate → assert outcome). NOT "is the button visible" — visibility belongs in L1/L2 against the component.

### L5 — External / Tier 2

Location: `packages/platform-ui/e2e/external/<feature>.test.ts`. Gated by `OPENROUTER_API_KEY` (test skips with diagnostic if missing).

```ts
import { test, expect } from 'vitest';

test.skipIf(!process.env.OPENROUTER_API_KEY)('real LLM call', async () => {
  // ...
});
```

Run: `OPENROUTER_API_KEY=... pnpm test:external`. NOT required for every PR — run before merging changes to `agent-runtime` / `mcp-client` / model code.

## Step 3 — RED

Run the test you just wrote. **It must fail.** And fail for the right reason — assertion mismatch on the behaviour you're about to add, not an import error or undefined symbol.

```bash
# L1/L2:
npx vitest run <path>

# L3:
pnpm test:e2e:api --grep '<test name>'

# L5:
OPENROUTER_API_KEY=... pnpm test:external --grep '<test name>'
```

If it passes already, the test is wrong — assertion is too weak, or the behaviour already exists. Fix the test before writing code.

## Step 4 — GREEN

Implement the smallest change that makes the test pass. Resist scope creep — extras go in their own commits with their own tests.

## Step 5 — Verify and layer up

1. Re-run the test you wrote — passes.
2. `pnpm typecheck && pnpm test:affected` — nothing else broke.
3. If you added L1/L2 for new HTTP behaviour, also add the L3. **An L2 alone never proves "API works".**

## Skip the test only for

Trivial edits: typos, comment-only diffs, single-line config. Say so out loud in the report.
