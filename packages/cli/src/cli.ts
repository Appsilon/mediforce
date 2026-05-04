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

import { workflowRegisterCommand } from './commands/workflow-register.js';
import { workflowListCommand } from './commands/workflow-list.js';
import { workflowGetCommand } from './commands/workflow-get.js';
import { runGetCommand } from './commands/run-get.js';
import { runListCommand } from './commands/run-list.js';
import { runStartCommand } from './commands/run-start.js';
import { workflowArchiveCommand } from './commands/workflow-archive.js';
import { systemStatusCommand, systemImagesCommand, systemDiskCommand, systemRmiCommand } from './commands/system-status.js';
import { agentListCommand } from './commands/agent-list.js';
import { agentGetCommand } from './commands/agent-get.js';
import { modelListCommand } from './commands/model-list.js';
import { modelGetCommand } from './commands/model-get.js';
import { modelSyncCommand } from './commands/model-sync.js';
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
  workflow get <name>                                Fetch a workflow definition
  workflow archive <name> --version <n>|--all       Archive/unarchive workflow versions
  agent list                                         List agent definitions
  agent get <id>                                     Fetch an agent definition
  model list                                         List models in registry
  model get <id>                                     Fetch a model from registry
  model sync                                         Sync models from OpenRouter
  run list                                           List recent runs
  run start --workflow <name>                        Start a new run (manual trigger)
  run get <runId>                                    Fetch a single run's status
  system status                                      Docker infrastructure status
  system images                                      List Docker images on host
  system rmi <imageId>                               Remove a Docker image
  system disk                                        Docker disk usage breakdown

Common flags:
  --base-url <url>   API base URL (default: http://localhost:9003,
                     or MEDIFORCE_BASE_URL env var)
  --json             Emit JSON instead of human-readable output
  --help, -h         Show this help text

Authentication:
  Set MEDIFORCE_API_KEY (or PLATFORM_API_KEY) in the environment.

Output streams:
  Success output and --json error payloads are written to stdout.
  Human-mode error messages are written to stderr so success output
  on stdout stays machine-parseable when piped.
`;

const WORKFLOW_HELP = `Usage: mediforce workflow <subcommand> [options]

Subcommands:
  register --file <path> --namespace <ns>   Register a workflow definition
  list                                      List registered workflow definitions
  get <name>                                Fetch a workflow definition
  archive <name> --version <n>|--all        Archive/unarchive workflow versions

Run \`mediforce workflow <subcommand> --help\` for subcommand-specific flags.
`;

const AGENT_HELP = `Usage: mediforce agent <subcommand> [options]

Subcommands:
  list                List agent definitions
  get <id>            Fetch an agent definition

Run \`mediforce agent <subcommand> --help\` for subcommand-specific flags.
`;

const MODEL_HELP = `Usage: mediforce model <subcommand> [options]

Subcommands:
  list                List models in registry
  get <id>            Fetch a model from registry
  sync                Sync models from OpenRouter

Run \`mediforce model <subcommand> --help\` for subcommand-specific flags.
`;

const RUN_HELP = `Usage: mediforce run <subcommand> [options]

Subcommands:
  list                      List recent runs
  start --workflow <name>   Start a new run (manual trigger)
  get <runId>               Fetch a single run's status

Run \`mediforce run <subcommand> --help\` for subcommand-specific flags.
`;

const SYSTEM_HELP = `Usage: mediforce system <subcommand> [options]

Subcommands:
  status     Full infrastructure status (images + disk + connectivity)
  images     List Docker images on the host
  rmi <id>   Remove a Docker image by ID or name:tag
  disk       Docker disk usage breakdown

Run \`mediforce system <subcommand> --help\` for subcommand-specific flags.
`;

export async function runCli(input: RunCliInput): Promise<number> {
  const output = input.output ?? consoleOutput;
  const args = input.argv;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    output.stdout(HELP);
    return 0;
  }

  const [command, subcommand, ...rest] = args;

  // Namespace-only invocation (no subcommand): print the namespaced HELP and
  // exit 2 instead of the generic `Unknown command: workflow undefined`.
  if (command === 'workflow' && subcommand === undefined) {
    output.stderr('mediforce workflow: missing subcommand');
    output.stderr('');
    output.stderr(WORKFLOW_HELP);
    return 2;
  }
  if (command === 'agent' && subcommand === undefined) {
    output.stderr('mediforce agent: missing subcommand');
    output.stderr('');
    output.stderr(AGENT_HELP);
    return 2;
  }
  if (command === 'run' && subcommand === undefined) {
    output.stderr('mediforce run: missing subcommand');
    output.stderr('');
    output.stderr(RUN_HELP);
    return 2;
  }
  if (command === 'model' && subcommand === undefined) {
    output.stderr('mediforce model: missing subcommand');
    output.stderr('');
    output.stderr(MODEL_HELP);
    return 2;
  }
  if (command === 'system' && subcommand === undefined) {
    output.stderr('mediforce system: missing subcommand');
    output.stderr('');
    output.stderr(SYSTEM_HELP);
    return 2;
  }

  if (command === 'workflow' && subcommand === 'register') {
    return workflowRegisterCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'workflow' && subcommand === 'list') {
    return workflowListCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'workflow' && subcommand === 'get') {
    return workflowGetCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'workflow' && subcommand === 'archive') {
    return workflowArchiveCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'agent' && subcommand === 'list') {
    return agentListCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'agent' && subcommand === 'get') {
    return agentGetCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'model' && subcommand === 'list') {
    return modelListCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'model' && subcommand === 'get') {
    return modelGetCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'model' && subcommand === 'sync') {
    return modelSyncCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'run' && subcommand === 'list') {
    return runListCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'run' && subcommand === 'get') {
    return runGetCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'run' && subcommand === 'start') {
    return runStartCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'system' && subcommand === 'status') {
    return systemStatusCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'system' && subcommand === 'images') {
    return systemImagesCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'system' && subcommand === 'rmi') {
    return systemRmiCommand({ argv: rest, env: input.env, output });
  }
  if (command === 'system' && subcommand === 'disk') {
    return systemDiskCommand({ argv: rest, env: input.env, output });
  }

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
