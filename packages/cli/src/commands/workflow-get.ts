import { writeFile } from 'node:fs/promises';
import { defineCommand } from '../define-command.js';
import { printError } from '../output.js';

const HELP = `Usage: mediforce workflow get <name> --namespace <ns> [options]

Fetch a workflow definition by name. Outputs the full definition JSON,
suitable for editing and re-registering with \`workflow register\`.

Positional:
  <name>               Workflow definition name

Required flags:
  --namespace <ns>     Namespace that owns the workflow

Optional flags:
  --version <n>        Specific version (default: latest)
  --output <path>      Write to file instead of stdout
  --template           Strip version/createdAt/namespace for re-registration
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON (default for this command)
  --help, -h           Show this help text
`;

export const workflowGetCommand = defineCommand({
  name: 'workflow get',
  help: HELP,
  options: {
    namespace: { type: 'string' },
    version: { type: 'string' },
    output: { type: 'string' },
    template: { type: 'boolean' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<name>'] as const,
  handler: async ({ flags, positionals, mediforce, output, jsonMode }) => {
    const name = positionals[0]!;

    const namespace = flags.namespace;
    if (typeof namespace !== 'string' || namespace.length === 0) {
      printError(output, { error: '--namespace is required' }, jsonMode);
      return 2;
    }

    const version =
      flags.version !== undefined ? Number(flags.version) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      printError(output, { error: `Invalid --version: ${flags.version}` }, jsonMode);
      return 2;
    }

    const result = await mediforce.workflows.get({ name, namespace, version });
    let payload: unknown = result.definition;

    if (flags.template === true) {
      const { version: _v, createdAt: _c, namespace: _n, ...template } = result.definition;
      payload = template;
    }

    const json = JSON.stringify(payload, null, 2);

    if (typeof flags.output === 'string' && flags.output.length > 0) {
      await writeFile(flags.output, json + '\n', 'utf-8');
      output.stdout(`Written to ${flags.output}`);
    } else {
      if (!jsonMode) {
        const def = result.definition;
        const stepCount = Array.isArray(def.steps) ? def.steps.length : 0;
        const transCount = Array.isArray(def.transitions) ? def.transitions.length : 0;
        const triggerCount = Array.isArray(def.triggers) ? def.triggers.length : 0;
        const visibility = def.visibility ?? 'private';
        output.stdout(
          `${def.name} v${String(def.version)} (namespace: ${def.namespace}, ${visibility}, ${String(stepCount)} steps, ${String(transCount)} transitions, ${String(triggerCount)} triggers)`,
        );
      }
      output.stdout(json);
    }
    return 0;
  },
});
