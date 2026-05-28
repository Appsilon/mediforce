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

export const secretSetCommand = defineCommand({
  name: 'mediforce secret set',
  description:
    'Set a secret. Value is encrypted at rest. Without --workflow, sets a workspace-level secret shared across all workflows.',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    key: { type: 'string', required: true, description: 'Secret key name' },
    workflow: { type: 'string', description: 'Workflow name (omit for workspace-level secret)' },
    value: { type: 'string', description: 'Secret value (visible in shell history — prefer --stdin)' },
    stdin: { type: 'boolean', description: 'Read value from stdin (pipe-friendly, no shell history)' },
  },
  async run({ args, output, stdin, mediforce, jsonMode }) {
    const hasValue = typeof args.value === 'string' && args.value.length > 0;
    const hasStdin = args.stdin === true;
    if (!hasValue && !hasStdin) {
      printError(output, { error: 'Provide --value or --stdin' }, jsonMode);
      return 2;
    }
    if (hasValue && hasStdin) {
      printError(
        output,
        { error: 'Flags are mutually exclusive: --value, --stdin' },
        jsonMode,
      );
      return 2;
    }

    let secretValue: string;
    if (hasStdin) {
      const readStdin = typeof stdin === 'function' ? stdin : readStdinDefault;
      secretValue = await readStdin();
      if (secretValue.length === 0) {
        printError(output, { error: 'stdin was empty — no value to set' }, jsonMode);
        return 1;
      }
    } else {
      secretValue = args.value as string;
    }

    await mediforce.secrets.set({
      namespace: args.namespace,
      ...(args.workflow !== undefined ? { workflow: args.workflow } : {}),
      key: args.key,
      value: secretValue,
    });
    if (jsonMode) {
      printJson(output, { ok: true });
    } else {
      const scope = args.workflow !== undefined
        ? `workflow "${args.workflow}" in namespace "${args.namespace}"`
        : `namespace "${args.namespace}"`;
      output.stdout(`Secret "${args.key}" set for ${scope}.`);
    }
    return 0;
  },
});
