import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const workflowListVersionsCommand = defineCommand({
  name: 'mediforce workflow list-versions',
  description:
    'List every persisted version of a workflow with metadata only (no full definition body). Use `workflow get --version=N` to fetch one version in full.',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Workflow definition name',
    },
    namespace: {
      type: 'string',
      required: true,
      description: 'Namespace that owns the workflow',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.workflows.versions({
      name: args.name,
      namespace: args.namespace,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    if (result.versions.length === 0) {
      output.stdout(`No versions found for workflow '${args.name}'.`);
      return 0;
    }

    const defaultLabel =
      result.defaultVersion === null
        ? 'no default pinned'
        : `default: v${String(result.defaultVersion)}`;
    output.stdout(
      `Found ${String(result.versions.length)} version(s) of '${args.name}' (${defaultLabel}):`,
    );
    for (const version of result.versions) {
      const flags = version.archived ? ' [archived]' : '';
      const title = version.title !== undefined ? `  "${version.title}"` : '';
      output.stdout(
        `  v${String(version.version)}${flags} — ${String(version.stepCount)} steps, ${String(version.triggerCount)} triggers${title}`,
      );
    }
    return 0;
  },
});
