import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dev:mock script', () => {
  it('runs the mock dev launcher instead of starting Next directly', () => {
    const packageJsonPath = resolve(__dirname, '../../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['dev:mock']).toBe('python3 scripts/dev-mock.py');
  });
});
