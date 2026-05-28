import { writeFile } from 'node:fs/promises';
import { defineCommand } from '../define-command.js';
import { printError } from '../output.js';

export const workflowGetCommand = defineCommand({
  name: 'mediforce workflow get',
  description:
    'Fetch a workflow definition by name. Outputs the full definition JSON, suitable for editing and re-registering with `workflow register`.',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Workflow definition name',
    },
    namespace: { type: 'string', required: true, description: 'Namespace that owns the workflow' },
    version: { type: 'string', description: 'Specific version (default: latest)' },
    output: { type: 'string', description: 'Write to file instead of stdout' },
    template: { type: 'boolean', description: 'Strip version/createdAt/namespace for re-registration' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const version =
      args.version !== undefined ? Number(args.version) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      printError(output, { error: `Invalid --version: ${args.version}` }, jsonMode);
      return 2;
    }

    const result = await mediforce.workflows.get({
      name: args.name,
      namespace: args.namespace,
      version,
    });
    let payload: unknown = result.definition;

    if (args.template === true) {
      const { version: _v, createdAt: _c, namespace: _n, ...template } = result.definition;
      payload = template;
    }

    const json = JSON.stringify(payload, null, 2);

    if (typeof args.output === 'string' && args.output.length > 0) {
      await writeFile(args.output, json + '\n', 'utf-8');
      output.stdout(`Written to ${args.output}`);
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
