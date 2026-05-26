import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce workflow copy <name> --target-namespace <ns> [options]

Copy a workflow definition to another namespace.

Positional:
  <name>                    Source workflow name

Required flags:
  --target-namespace <ns>   Target namespace for the copy

Optional flags:
  --name <new-name>         Name in target namespace (default: same as source)
  --version <n>             Source version to copy (default: latest)
  --base-url <url>          API base URL (default: http://localhost:9003)
  --json                    Emit JSON instead of human-readable output
  --help, -h                Show this help text
`;

export const workflowCopyCommand = defineCommand({
  name: 'workflow copy',
  help: HELP,
  options: {
    'target-namespace': { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<name>'] as const,
  handler: async ({ flags, positionals, mediforce, output, jsonMode }) => {
    const sourceName = positionals[0]!;

    const targetNamespace = flags['target-namespace'];
    if (typeof targetNamespace !== 'string' || targetNamespace.length === 0) {
      printError(output, { error: '--target-namespace is required' }, jsonMode);
      return 2;
    }

    const version = flags.version !== undefined ? Number(flags.version) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      printError(output, { error: '--version must be a positive integer' }, jsonMode);
      return 2;
    }

    const result = await mediforce.workflows.copy(
      { name: sourceName, version, targetName: flags.name },
      { targetNamespace },
    );
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Copied ${result.copiedFrom.name} v${result.copiedFrom.version} → ${targetNamespace}/${result.name} v${result.version}`,
      );
    }
    return 0;
  },
});
