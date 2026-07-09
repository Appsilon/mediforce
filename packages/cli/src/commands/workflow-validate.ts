import { readFile } from 'node:fs/promises';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const workflowValidateCommand = defineCommand({
  name: 'mediforce workflow validate',
  description:
    'Validate a workflow definition JSON file against the canonical schema without registering it. Reports structured errors; exits non-zero when invalid.',
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Path to the workflow definition JSON file',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    let raw: string;
    try {
      raw = await readFile(args.file, 'utf-8');
    } catch (err) {
      printError(output, { error: `Failed to read file: ${args.file} — ${String(err)}` }, jsonMode);
      return 1;
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        printError(output, { error: 'Expected a JSON object' }, jsonMode);
        return 1;
      }
      body = parsed as Record<string, unknown>;
    } catch (err) {
      printError(output, { error: `Invalid JSON: ${String(err)}` }, jsonMode);
      return 1;
    }

    const result = await mediforce.workflows.validate(body);

    if (jsonMode) {
      printJson(output, result);
    } else if (result.valid) {
      output.stdout('Valid — the workflow definition conforms to the schema.');
    } else {
      output.stderr(`Invalid — ${String(result.errors.length)} error(s):`);
      for (const issue of result.errors) {
        output.stderr(`  - ${issue.path ? `${issue.path}: ` : ''}${issue.message}`);
      }
    }

    return result.valid ? 0 : 1;
  },
});
