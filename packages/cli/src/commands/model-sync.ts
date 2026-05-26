import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const HELP = `Usage: mediforce model sync [options]

Sync model registry from OpenRouter API.

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const modelSyncCommand = defineCommand({
  name: 'model sync',
  help: HELP,
  options: {
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ mediforce, output, jsonMode }) => {
    output.stdout('Syncing models from OpenRouter...');
    const result = await mediforce.models.sync();
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Synced ${String(result.synced)} models (${String(result.total)} total from OpenRouter)`);
    output.stdout(`Last synced: ${result.lastSyncedAt}`);
    return 0;
  },
});
