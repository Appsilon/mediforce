import { readFile } from 'node:fs/promises';
import { defineCommand } from '../define-command';
import { printJson, printError, printKv } from '../output';

export const taskCompleteCommand = defineCommand({
  name: 'mediforce task complete',
  description: 'Complete a human task with a JSON payload.',
  args: {
    taskId: { type: 'positional', required: true, description: 'Task id' },
    payload: { type: 'string', description: 'Inline JSON payload' },
    'payload-file': { type: 'string', description: 'Read payload from file (use - for stdin)' },
  },
  async run({ args, output, stdin, mediforce, jsonMode }) {
    if (args.payload !== undefined && args['payload-file'] !== undefined) {
      printError(output, { error: 'Flags are mutually exclusive: --payload, --payload-file' }, jsonMode);
      return 2;
    }

    let raw: string | undefined;
    if (typeof args.payload === 'string') {
      raw = args.payload;
    } else if (typeof args['payload-file'] === 'string') {
      if (args['payload-file'] === '-') {
        if (typeof stdin !== 'function') {
          printError(output, { error: 'stdin not available' }, jsonMode);
          return 2;
        }
        raw = await stdin();
      } else {
        try {
          raw = await readFile(args['payload-file'], 'utf-8');
        } catch (err) {
          printError(output, { error: `Cannot read --payload-file '${args['payload-file']}': ${String(err)}` }, jsonMode);
          return 2;
        }
      }
    }

    if (raw === undefined) {
      printError(output, { error: 'Provide --payload or --payload-file' }, jsonMode);
      return 2;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      printError(output, { error: 'Payload is not valid JSON' }, jsonMode);
      return 2;
    }

    const result = await mediforce.tasks.complete({
      taskId: args.taskId,
      payload: payload as Record<string, unknown>,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Task ${result.task.id} completed`);
    printKv(output, [
      ['taskStatus', result.task.status],
      ['runId', result.run.id],
      ['runStatus', result.run.status],
    ]);
    return 0;
  },
});
