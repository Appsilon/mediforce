/**
 * Process-lifecycle entry for the `mediforce` CLI.
 *
 * Kept separate from `./cli.ts` so that the library module exports `runCli`
 * and `TREE` without any side-effecty `process.exit` calls. This file is what
 * `bin/mediforce.cjs` spawns via tsx.
 */

import { runCli } from './cli';

runCli({ argv: process.argv.slice(2), env: process.env })
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    // Any uncaught error inside a command path is treated as an operational
    // failure — print to stderr and exit non-zero.
    process.stderr.write(`mediforce: ${String(err)}\n`);
    process.exit(1);
  });
