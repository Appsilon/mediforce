import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce workflow archive <name> [options]

Archive or unarchive a workflow definition version (or all versions).

Positional:
  <name>               Workflow definition name

Required flags (one of):
  --version <n>        Archive a specific version
  --all                Archive all versions

Optional flags:
  --unarchive          Unarchive instead of archive
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text

Examples:
  mediforce workflow archive my-workflow --version 3
  mediforce workflow archive my-workflow --version 3 --unarchive
  mediforce workflow archive my-workflow --all
`;

export const workflowArchiveCommand = defineCommand({
  name: 'workflow archive',
  help: HELP,
  options: {
    version: { type: 'string' },
    all: { type: 'boolean' },
    unarchive: { type: 'boolean' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<name>'] as const,
  handler: async ({ flags, positionals, mediforce, output, jsonMode }) => {
    const name = positionals[0]!;
    const archived = flags.unarchive !== true;

    if (flags.all !== true && flags.version === undefined) {
      printError(output, { error: 'Either --version <n> or --all is required' }, jsonMode);
      return 2;
    }

    if (flags.all === true && flags.version !== undefined) {
      printError(output, { error: '--version and --all are mutually exclusive' }, jsonMode);
      return 2;
    }

    const version = flags.version !== undefined ? Number(flags.version) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      printError(output, { error: `Invalid --version: ${flags.version}` }, jsonMode);
      return 2;
    }

    const action = archived ? 'Archived' : 'Unarchived';

    if (version !== undefined) {
      const result = await mediforce.workflows.archiveVersion({
        name,
        version,
        archived,
      });
      if (jsonMode) {
        printJson(output, result);
      } else {
        output.stdout(`${action} ${name} v${String(version)}`);
      }
    } else {
      const result = await mediforce.workflows.archiveAll({ name, archived });
      if (jsonMode) {
        printJson(output, result);
      } else {
        output.stdout(`${action} all versions of ${name}`);
      }
    }
    return 0;
  },
});
