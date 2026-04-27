/**
 * `mediforce` CLI entrypoint.
 *
 * Subcommand dispatch is a single switch on `argv[2]/argv[3]` — keeps the
 * binary dependency-free (only `node:util`'s `parseArgs` for flags).
 *
 * Surface (MVP):
 *   mediforce workflow register --file <path> --namespace <ns> [...flags]
 *   mediforce workflow list                                    [...flags]
 *   mediforce run get <runId>                                  [...flags]
 *
 * Exit codes:
 *   0 — success
 *   1 — operational failure (HTTP error, validation error, file not found)
 *   2 — usage error (unknown command, missing required flag)
 *
 * Commands are registered as `runCli` grows; this scaffold ships the help
 * text and unknown-command path. Per-command dispatch is wired in subsequent
 * commits as each command lands.
 */

import { consoleOutput, type OutputSink } from './output.js';

export interface RunCliInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output?: OutputSink;
}

const HELP = `Usage: mediforce <command> [options]

Commands:
  workflow register --file <path> --namespace <ns>   Register a workflow definition
  workflow list                                      List registered workflow definitions
  run get <runId>                                    Fetch a single run's status

Common flags:
  --base-url <url>   API base URL (default: http://localhost:9003,
                     or MEDIFORCE_BASE_URL env var)
  --json             Emit JSON instead of human-readable output
  --help, -h         Show this help text

Authentication:
  Set MEDIFORCE_API_KEY (or PLATFORM_API_KEY) in the environment.
`;

export async function runCli(input: RunCliInput): Promise<number> {
  const output = input.output ?? consoleOutput;
  const args = input.argv;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    output.stdout(HELP);
    return 0;
  }

  const [command, subcommand] = args;

  output.stderr(`Unknown command: ${[command, subcommand].filter(Boolean).join(' ')}`);
  output.stderr('');
  output.stderr(HELP);
  return 2;
}

// Direct execution: spawned by `bin/mediforce.cjs`.
const isDirectInvocation =
  typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
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
}
