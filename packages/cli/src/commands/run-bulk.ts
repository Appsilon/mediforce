import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';
import type { CommandFn } from '../define-command';

function parseRunIds(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const runBulkCancelCommand: CommandFn = defineCommand({
  name: 'mediforce run bulk-cancel',
  description: "Cancel multiple runs in one call. Per-item failures don't abort the batch.",
  args: {
    runIds: {
      type: 'positional',
      required: true,
      description: 'Comma-separated run IDs (e.g. id1,id2,id3)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const ids = parseRunIds(args.runIds);
    if (ids.length === 0) {
      printError(output, { error: 'at least one runId is required' }, jsonMode);
      return 2;
    }
    const result = await mediforce.runs.bulkCancel({ runIds: ids });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const ok = result.results.filter((r) => r.status === 'ok').length;
    const failed = result.results.filter((r) => r.status === 'error');
    output.stdout(`Bulk cancel: ${String(ok)} ok, ${String(failed.length)} failed`);
    for (const f of failed) {
      output.stdout(`  ${f.id}: ${f.error ?? 'unknown error'}`);
    }
    return failed.length === 0 ? 0 : 1;
  },
});

export const runBulkArchiveCommand: CommandFn = defineCommand({
  name: 'mediforce run bulk-archive',
  description: "Archive multiple completed runs in one call. Per-item failures don't abort.",
  args: {
    runIds: {
      type: 'positional',
      required: true,
      description: 'Comma-separated run IDs (e.g. id1,id2,id3)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const ids = parseRunIds(args.runIds);
    if (ids.length === 0) {
      printError(output, { error: 'at least one runId is required' }, jsonMode);
      return 2;
    }
    const result = await mediforce.runs.bulkArchive({ runIds: ids });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const ok = result.results.filter((r) => r.status === 'ok').length;
    const failed = result.results.filter((r) => r.status === 'error');
    output.stdout(`Bulk archive: ${String(ok)} ok, ${String(failed.length)} failed`);
    for (const f of failed) {
      output.stdout(`  ${f.id}: ${f.error ?? 'unknown error'}`);
    }
    return failed.length === 0 ? 0 : 1;
  },
});
