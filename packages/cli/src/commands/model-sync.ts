import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const modelSyncCommand = defineCommand({
  name: 'mediforce model sync',
  description: 'Sync model registry from OpenRouter API.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    output.stdout('Syncing models from OpenRouter...');
    const result = await mediforce.models.sync();
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Synced ${String(result.synced)} models (${String(result.total)} total from OpenRouter)`);
    output.stdout(`Retired: ${String(result.retired)}, Reinstated: ${String(result.reinstated)}, Rankings updated: ${String(result.rankingsUpdated)}`);
    output.stdout(`Last synced: ${result.lastSyncedAt}`);
    return 0;
  },
});
