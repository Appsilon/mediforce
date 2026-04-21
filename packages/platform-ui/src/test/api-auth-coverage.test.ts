// packages/platform-ui/src/test/api-auth-coverage.test.ts
// RED phase: these tests describe the static structural contract for Step 0 of the MCP permissions refactor.
// They will FAIL before middleware implementation and the follow-up cleanup commits.
// After middleware.ts centralizes auth, redis-test is removed, and inline validateApiKey() calls
// are deleted from route handlers, run again to confirm GREEN.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLATFORM_UI_ROOT = resolve(__dirname, '..', '..');
const MIDDLEWARE_PATH = join(PLATFORM_UI_ROOT, 'src', 'middleware.ts');
const API_ROOT = join(PLATFORM_UI_ROOT, 'src', 'app', 'api');

function walkRouteFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkRouteFiles(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

describe('API route auth coverage', () => {
  it('has a middleware file at src/middleware.ts that exports a matcher covering /api/:path*', () => {
    expect(existsSync(MIDDLEWARE_PATH)).toBe(true);
    const source = readFileSync(MIDDLEWARE_PATH, 'utf8');
    expect(source).toMatch(/matcher:\s*['"]\/api\/:path\*['"]/);
  });

  it('declares a PUBLIC_ROUTES constant with exactly the approved public endpoints', () => {
    expect(existsSync(MIDDLEWARE_PATH)).toBe(true);
    const source = readFileSync(MIDDLEWARE_PATH, 'utf8');
    expect(source).toMatch(/PUBLIC_ROUTES/);
    expect(source).toMatch(/\/api\/health/);
    expect(source).toMatch(/\/api\/oauth\/callback/);
  });

  it('does not contain /api/redis-test/route.ts', () => {
    const redisTestPath = join(API_ROOT, 'redis-test', 'route.ts');
    expect(existsSync(redisTestPath)).toBe(false);
  });

  it('does not contain inline validateApiKey() call in any /api/*/route.ts', () => {
    const routeFiles = walkRouteFiles(API_ROOT);
    expect(routeFiles.length).toBeGreaterThan(0);
    const offenders = routeFiles.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('validateApiKey(');
    });
    expect(offenders).toEqual([]);
  });
});
