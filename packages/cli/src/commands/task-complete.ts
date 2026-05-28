import { readFileSync } from 'node:fs';
import { CompleteTaskPayloadSchema } from '@mediforce/platform-api/contract';
import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

function readStdinDefault(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    process.stdin.on('error', reject);
  });
}

export const taskCompleteCommand = defineCommand({
  name: 'mediforce task complete',
  description:
    "Complete a human task with a JSON payload. Payload shape matches CompleteHumanTaskPayload (discriminated by `kind`: verdict|params|upload|assignment|rows).",
  args: {
    taskId: {
      type: 'positional',
      required: true,
      description: 'Task ID',
    },
    payload: {
      type: 'string',
      description: 'JSON payload inline (e.g. \'{"kind":"verdict","verdict":"approve"}\')',
    },
    'payload-file': {
      type: 'string',
      description: 'Path to a JSON file with the payload, or `-` to read from stdin',
    },
  },
  async run({ args, output, stdin, mediforce, jsonMode }) {
    const hasInline = typeof args.payload === 'string' && args.payload.length > 0;
    const hasFile = typeof args['payload-file'] === 'string' && args['payload-file'].length > 0;
    if (!hasInline && !hasFile) {
      printError(output, { error: 'Provide --payload or --payload-file' }, jsonMode);
      return 2;
    }
    if (hasInline && hasFile) {
      printError(output, { error: 'Flags are mutually exclusive: --payload, --payload-file' }, jsonMode);
      return 2;
    }

    let rawJson: string;
    if (hasInline) {
      rawJson = args.payload as string;
    } else {
      const path = args['payload-file'] as string;
      if (path === '-') {
        const readStdin = typeof stdin === 'function' ? stdin : readStdinDefault;
        rawJson = await readStdin();
        if (rawJson.length === 0) {
          printError(output, { error: 'stdin was empty — no payload to send' }, jsonMode);
          return 1;
        }
      } else {
        try {
          rawJson = readFileSync(path, 'utf-8');
        } catch (err) {
          printError(output, { error: `failed to read ${path}: ${String(err)}` }, jsonMode);
          return 1;
        }
      }
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch (err) {
      printError(output, { error: `invalid JSON payload: ${String(err)}` }, jsonMode);
      return 1;
    }

    const parsed = CompleteTaskPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      printError(output, { error: `invalid payload shape: ${parsed.error.message}` }, jsonMode);
      return 1;
    }

    const result = await mediforce.tasks.complete({
      taskId: args.taskId,
      payload: parsed.data,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Task ${result.task.id} completed (kind=${parsed.data.kind})`);
    output.stdout(`  run:    ${result.run.id}`);
    output.stdout(`  status: ${result.run.status}`);
    return 0;
  },
});
