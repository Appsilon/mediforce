// Structural guard for ADR-0004's authorization wrapper layer.
//
// Every handler file under `packages/platform-api/src/handlers/<domain>/`
// must reach data through a `CallerScope` — never through a raw repository
// interface or a Firestore client. The TypeScript handler signature already
// hides raw repos; this test is a belt-and-suspenders structural check that
// catches a handler that tries to import its way around the wrapper.
//
// Banned (every handler file):
//   - imports from `@mediforce/platform-core/interfaces` (raw repo interfaces)
//   - imports from `@mediforce/platform-core/repositories`
//
// Banned EXCEPT @public-handler:
//   - imports from `@mediforce/platform-infra` (concrete Firestore/Mailgun/etc).
//     Genuinely-public, platform-global handlers (model registry sync, plugin
//     listings) sometimes need infra calls that have no per-workspace gate.
//     Such handlers MUST annotate themselves `// @public-handler` with a
//     one-line reason on the next line — a conscious decision visible in the
//     diff, not a silent bypass.
//
// Why this guard exists: handlers receive `scope: CallerScope` as a uniform
// second argument. The TypeScript signature forces a handler to *use* a
// scope, but it can't force the handler to *only* use one. If a handler
// imports `FirestoreProcessInstanceRepository` directly and bypasses the
// workspace gate, the compiler is happy and the regression is silent.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HANDLERS_ROOT = resolve(__dirname, '..');

const ALWAYS_BANNED: readonly RegExp[] = [
  /from\s+['"]@mediforce\/platform-core\/interfaces/,
  /from\s+['"]@mediforce\/platform-core\/repositories/,
];

// TODO(ADR-0004 follow-up): tighten guard to also reject `import type { *Repository }`
// from the top-level `@mediforce/platform-core` barrel. Today the barrel re-exports
// raw repo types (ProcessInstanceRepository, HumanTaskRepository, etc.) and the
// subpath bans above don't catch that route — only the handler signature does.

/** Banned EXCEPT in @public-handler files. */
const PUBLIC_GATED_BANNED: readonly RegExp[] = [/from\s+['"]@mediforce\/platform-infra(['"\/])/];

const PUBLIC_MARKER = '@public-handler';

function listHandlerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...listHandlerFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry === 'index.ts') continue;
    out.push(full);
  }
  return out;
}

describe('platform-api handlers may not import raw repositories', () => {
  it('no handler imports from @mediforce/platform-core/interfaces or /repositories', () => {
    const files = listHandlerFiles(HANDLERS_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (ALWAYS_BANNED.some((re) => re.test(src))) offenders.push(file);
    }

    expect(
      offenders,
      `\nThese handlers import raw repository interfaces directly. Reach data through the\nCallerScope wrapper (\`scope.tasks\`, \`scope.runs\`, etc.) instead.\n\nOffenders:\n${offenders.map((f) => `  - ${f}`).join('\n')}\n`,
    ).toEqual([]);
  });

  it('only @public-handler files may import from @mediforce/platform-infra', () => {
    const files = listHandlerFiles(HANDLERS_ROOT);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const usesInfra = PUBLIC_GATED_BANNED.some((re) => re.test(src));
      if (!usesInfra) continue;
      if (!src.includes(PUBLIC_MARKER)) offenders.push(file);
    }

    expect(
      offenders,
      `\nThese handlers import @mediforce/platform-infra without the @public-handler\nannotation. Either annotate with "// @public-handler" + a one-line reason\n(genuinely-public, platform-global only) or route the call through CallerScope.\n\nOffenders:\n${offenders.map((f) => `  - ${f}`).join('\n')}\n`,
    ).toEqual([]);
  });
});
