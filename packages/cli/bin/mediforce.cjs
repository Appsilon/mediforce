#!/usr/bin/env node
/**
 * Bin shim for @mediforce/cli.
 *
 * Resolves `tsx` from the package's own deps and delegates to it so the CLI
 * runs straight from `src/cli.ts` without a build step. Keeps MVP iteration
 * tight; once the CLI stabilises this can be replaced with a tsc-emitted
 * `dist/cli.js` and the shebang moved there.
 *
 * `pnpm exec mediforce …` from anywhere in the workspace ends up here via
 * the `bin` field in package.json.
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const entry = path.join(packageRoot, 'src', 'cli.ts');

let tsxBin;
try {
  // require.resolve('tsx/cli') points at the CommonJS entry that runs the CLI.
  tsxBin = require.resolve('tsx/cli', { paths: [packageRoot] });
} catch (err) {
  console.error(
    'mediforce: could not resolve `tsx` runtime. Run `pnpm install` from the workspace root.',
  );
  console.error(String(err));
  process.exit(2);
}

// `--conditions=@mediforce/source` makes Node's ESM resolver pick the
// `./src/...` entry from each workspace package's `exports`, matching the
// custom condition declared in tsconfig.json. Without it, the resolver
// falls back to `./dist/...` which has not been built in dev.
//
// Passed via NODE_OPTIONS rather than as an argv flag because tsx parses
// argv before the runtime sees it, and a leading `--conditions=…` would be
// consumed by tsx's own arg parser instead of reaching the ESM loader.
const env = { ...process.env };
const existing = env.NODE_OPTIONS ?? '';
env.NODE_OPTIONS = existing.includes('--conditions=@mediforce/source')
  ? existing
  : `${existing} --conditions=@mediforce/source`.trim();

const result = spawnSync(
  process.execPath,
  [tsxBin, entry, ...process.argv.slice(2)],
  { stdio: 'inherit', env },
);

if (result.error !== undefined) {
  console.error(`mediforce: failed to spawn tsx — ${String(result.error)}`);
  process.exit(2);
}

process.exit(result.status ?? 0);
