// packages/platform-ui/src/test/api-boundaries.test.ts
//
// Static structural contract for the `@mediforce/platform-api` boundary.
// Mirrors the pattern in `api-auth-coverage.test.ts`: scan source files,
// assert structural invariants, fail CI if anything drifts.
//
// Two conventions enforced:
//
//   1. UI import boundary — UI code may import `@mediforce/platform-api/contract`
//      (types + schemas), `@mediforce/platform-api/services` (factory, via the
//      `@/lib/platform-services` shim), and `@mediforce/platform-api/client`
//      (runtime-agnostic typed client). Handler imports and bare-package
//      imports are reserved for the adapter surface (Next.js route handlers,
//      server actions, and `lib/route-adapter.ts` itself).
//
//   2. Handler test presence — every handler file in
//      `packages/platform-api/src/handlers/` (except `index.ts`) must have a
//      sibling `__tests__/<name>.test.ts`.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const PLATFORM_UI_ROOT = resolve(__dirname, '..', '..');
const MONOREPO_ROOT = resolve(PLATFORM_UI_ROOT, '..', '..');
const UI_SRC = join(PLATFORM_UI_ROOT, 'src');
const API_HANDLERS = join(
  MONOREPO_ROOT,
  'packages',
  'platform-api',
  'src',
  'handlers',
);

// Files allowed to import handlers from @mediforce/platform-api — they form
// the thin HTTP adapter layer between Next.js and pure handlers.
//
// `app/actions/*.ts` (server actions) are included for symmetry, but note:
// middleware.ts matches `/api/:path*` only, so server actions are NOT
// auto-protected. Actions that import handlers must do their own auth check.
// See the auth-scope note in lib/route-adapter.ts. Tighten this predicate
// if middleware ever grows to guard `app/actions`.
function isAdapterFile(absolutePath: string): boolean {
  const rel = relative(UI_SRC, absolutePath);
  if (rel === join('lib', 'route-adapter.ts')) return true;
  if (rel.startsWith(join('app', 'api')) && rel.endsWith('route.ts')) return true;
  if (rel.startsWith(join('app', 'api')) && rel.endsWith('route.tsx')) return true;
  if (rel.startsWith(join('app', 'actions')) && rel.endsWith('.ts')) return true;
  return false;
}

function isTestFile(absolutePath: string): boolean {
  return (
    absolutePath.endsWith('.test.ts') ||
    absolutePath.endsWith('.test.tsx') ||
    absolutePath.includes(`${sep}__tests__${sep}`)
  );
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !isTestFile(full)
    ) {
      out.push(full);
    }
  }
  return out;
}

// Matches both static/re-export/type-only imports (`from '...'`) and dynamic
// imports (`import('...')`) referencing the bare package or the `/handlers`
// subpath. Allowed subpaths (`/contract`, `/services`, `/client`) are not
// matched. The self-test below guards this pattern against regressions.
const FORBIDDEN_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]@mediforce\/platform-api(?:\/handlers(?:\/[^'"]+)?)?['"]/;

describe('platform-api boundary conventions', () => {
  it('does not import handlers from @mediforce/platform-api in non-adapter UI files', () => {
    const files = walkSourceFiles(UI_SRC).filter((f) => !isAdapterFile(f));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const line of source.split('\n')) {
        if (FORBIDDEN_IMPORT.test(line)) {
          offenders.push(`${relative(MONOREPO_ROOT, file)}: ${line.trim()}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every handler has a sibling __tests__/<name>.test.ts', () => {
    if (!existsSync(API_HANDLERS)) return;

    const handlers: string[] = [];
    (function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (entry !== '__tests__') walk(full);
        } else if (entry.endsWith('.ts') && entry !== 'index.ts') {
          handlers.push(full);
        }
      }
    })(API_HANDLERS);

    expect(handlers.length).toBeGreaterThan(0);

    const missing = handlers.filter((handler) => {
      const dir = handler.slice(0, handler.lastIndexOf('/'));
      const name = handler.slice(dir.length + 1).replace(/\.ts$/, '');
      const expectedTest = join(dir, '__tests__', `${name}.test.ts`);
      return !existsSync(expectedTest);
    });

    expect(
      missing.map((f) => relative(MONOREPO_ROOT, f)),
      'Every handler needs a sibling __tests__/<name>.test.ts — see docs/ENGINE-TESTING.md',
    ).toEqual([]);
  });
});

describe('FORBIDDEN_IMPORT regex self-test', () => {
  it('matches static handler subpath import', () => {
    expect(
      FORBIDDEN_IMPORT.test(`import { x } from '@mediforce/platform-api/handlers'`),
    ).toBe(true);
  });

  it('matches bare-package import (double quotes)', () => {
    expect(
      FORBIDDEN_IMPORT.test(`import { x } from "@mediforce/platform-api"`),
    ).toBe(true);
  });

  it('matches deep handler subpath import', () => {
    expect(
      FORBIDDEN_IMPORT.test(
        `import { listTasks } from '@mediforce/platform-api/handlers/tasks/list-tasks'`,
      ),
    ).toBe(true);
  });

  it('matches dynamic import of handlers', () => {
    expect(
      FORBIDDEN_IMPORT.test(`const m = await import('@mediforce/platform-api/handlers');`),
    ).toBe(true);
  });

  it('matches re-export from handlers', () => {
    expect(
      FORBIDDEN_IMPORT.test(`export { x } from '@mediforce/platform-api/handlers'`),
    ).toBe(true);
  });

  it('matches type-only import from handlers', () => {
    expect(
      FORBIDDEN_IMPORT.test(`import type { X } from '@mediforce/platform-api/handlers'`),
    ).toBe(true);
  });

  it('does not match allowed /client subpath', () => {
    expect(
      FORBIDDEN_IMPORT.test(`import { c } from '@mediforce/platform-api/client'`),
    ).toBe(false);
  });

  it('does not match allowed /contract subpath', () => {
    expect(
      FORBIDDEN_IMPORT.test(`import { c } from '@mediforce/platform-api/contract'`),
    ).toBe(false);
  });

  it('does not match allowed /services subpath', () => {
    expect(
      FORBIDDEN_IMPORT.test(`import { c } from '@mediforce/platform-api/services'`),
    ).toBe(false);
  });

  it('does not match bare string literal outside import context', () => {
    expect(
      FORBIDDEN_IMPORT.test(`const x = '@mediforce/platform-api/handlers'`),
    ).toBe(false);
  });
});
