import { readFile } from 'node:fs/promises';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';
import { readStdin } from '../stdin';

export const assistantInstructionsSetCommand = defineCommand({
  name: 'mediforce assistant instructions-set',
  description:
    "Replace one person's standing instructions for the workflow assistant in a workspace — the extra system prompt every turn there reads. Keep them in a file and push it: --file is the usual form. --clear removes them.",
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    uid: {
      type: 'string',
      description: 'Whose instructions to write (required when authenticated via apiKey)',
    },
    file: { type: 'string', description: 'Read the instructions from this file' },
    stdin: { type: 'boolean', description: 'Read the instructions from stdin' },
    clear: { type: 'boolean', description: 'Remove them' },
  },
  async run({ args, output, stdin, mediforce, jsonMode }) {
    const sources = [args.file !== undefined, args.stdin === true, args.clear === true]
      .filter((provided) => provided === true).length;
    if (sources === 0) {
      printError(output, { error: 'Provide --file, --stdin, or --clear' }, jsonMode);
      return 2;
    }
    if (sources > 1) {
      printError(
        output,
        { error: 'Flags are mutually exclusive: --file, --stdin, --clear' },
        jsonMode,
      );
      return 2;
    }

    let instructions = '';
    if (args.file !== undefined) {
      try {
        instructions = await readFile(args.file, 'utf-8');
      } catch (err) {
        printError(
          output,
          { error: `Could not read --file: ${err instanceof Error ? err.message : String(err)}` },
          jsonMode,
        );
        return 2;
      }
      if (instructions.trim() === '') {
        printError(output, { error: 'That file is empty — use --clear to remove them' }, jsonMode);
        return 1;
      }
    } else if (args.stdin === true) {
      const read = typeof stdin === 'function' ? stdin : readStdin;
      instructions = await read();
      if (instructions.trim() === '') {
        printError(output, { error: 'stdin was empty — use --clear to remove them' }, jsonMode);
        return 1;
      }
    }

    await mediforce.assistant.setInstructions({
      namespace: args.namespace,
      ...(args.uid !== undefined ? { uid: args.uid } : {}),
      instructions,
    });

    if (jsonMode) {
      printJson(output, { ok: true });
    } else if (instructions === '') {
      output.stdout(`Assistant instructions cleared for workspace "${args.namespace}".`);
    } else {
      output.stdout(
        `Assistant instructions set for workspace "${args.namespace}" (${String(instructions.length)} characters).`,
      );
    }
    return 0;
  },
});
