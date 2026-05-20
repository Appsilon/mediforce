// Auth coverage guard for the platform-api handler layer.
//
// Every handler file under `packages/platform-api/src/handlers/<domain>/` must
// either (a) enforce a namespace policy by calling one of the canonical helpers
// from `../auth.ts`, or (b) explicitly mark itself `// @public-handler` with a
// human-readable reason on the next line, so a reviewer can see the conscious
// decision in the diff.
//
// Why this guard exists: handlers receive `caller: CallerIdentity` as a uniform
// third argument. The TypeScript signature forces a handler to *accept* a
// caller, but it can't force the handler to *use* one. If someone writes a new
// `getThing(input, deps, caller)` that ignores the caller entirely, the
// compiler is happy and the regression is silent. This sibling test grep's the
// handler source and fails CI if a handler neither gates nor explicitly opts
// out.
//
// Add a new auth-aware helper? Extend `AUTH_MARKERS`.
// Add a new genuinely-public handler? Annotate it with `// @public-handler`
// followed by a single-line reason.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HANDLERS_ROOT = resolve(__dirname, '..');

const AUTH_MARKERS: readonly RegExp[] = [
  /\bassertNamespaceAccess\s*\(/,
  /\bcallerCanAccess\s*\(/,
  /\bfilterByCaller\s*\(/,
  /\bcaller\.kind\b/,
  /\bcaller\.namespaces\b/,
];

const PUBLIC_MARKER = '@public-handler';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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
    // Only domain-grouped handlers (foo/bar.ts), not loose siblings of index.ts.
    out.push(full);
  }
  return out;
}

describe('platform-api handler auth coverage', () => {
  it('every handler either references an auth helper OR is annotated @public-handler', () => {
    const files = listHandlerFiles(HANDLERS_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const rawSource = readFileSync(file, 'utf8');
      const isAnnotatedPublic = rawSource.includes(PUBLIC_MARKER);
      const stripped = stripComments(rawSource);
      const isAuthAware = AUTH_MARKERS.some((m) => m.test(stripped));
      if (!isAuthAware && !isAnnotatedPublic) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `\nThese handlers don't gate on caller and aren't annotated @public-handler.\nAdd a namespace check (assertNamespaceAccess / callerCanAccess / filterByCaller)\nor annotate the handler with "// @public-handler" + a one-line reason.\n\nOffenders:\n${offenders.map((f) => `  - ${f}`).join('\n')}\n`,
    ).toEqual([]);
  });
});
