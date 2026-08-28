import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

/**
 * Read one workflow's `run` / `edit` role gates (ADR-0019).
 *
 * Any member of the workspace can read them — this is where someone finds out
 * why their run was refused. `workflow set-access` writes them, owner/admin
 * only.
 */
export const workflowAccessCommand = defineCommand({
  name: 'mediforce workflow access',
  description: 'Show who may run and who may edit a workflow.',
  args: {
    name: { type: 'positional', required: true, description: 'Workflow definition name' },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.workflows.getAccess({
      name: args.name,
      namespace: args.namespace!,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Access for ${result.namespace}/${result.name}`);
    printKv(output, [
      ['run', describe(result.access.run)],
      ['edit', describe(result.access.edit)],
      ['you may run', result.caller.mayRun ? 'yes' : 'no'],
      ['you may edit', result.caller.mayEdit ? 'yes' : 'no'],
    ]);
    return 0;
  },
});

/**
 * Replace both gates in one write, mirroring `namespace set-member-roles`:
 * full replace, and `--run ""` is how you say "any member" rather than
 * "leave it alone". Both flags are required for the same reason that command
 * requires `--roles` — omitting one and clearing it must not look the same.
 */
export const workflowSetAccessCommand = defineCommand({
  name: 'mediforce workflow set-access',
  description:
    'Set who may run and who may edit a workflow. Owner/admin only. Empty ("") means any workspace member.',
  args: {
    name: { type: 'positional', required: true, description: 'Workflow definition name' },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    run: {
      type: 'string',
      required: true,
      description: 'Comma-separated roles allowed to start a run, or "" for any member',
    },
    edit: {
      type: 'string',
      required: true,
      description:
        'Comma-separated roles allowed to register, archive, delete, transfer or re-point it, or "" for any member',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.workflows.setAccess({
      name: args.name,
      namespace: args.namespace!,
      access: { run: parseRoles(args.run), edit: parseRoles(args.edit) },
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Set access for ${result.namespace}/${result.name}`);
    printKv(output, [
      ['run', describe(result.access.run)],
      ['edit', describe(result.access.edit)],
    ]);
    return 0;
  },
});

function parseRoles(raw: string): string[] {
  return [...new Set(raw.split(',').map((role) => role.trim()).filter((role) => role !== ''))];
}

function describe(roles: readonly string[]): string {
  return roles.length > 0 ? roles.join(', ') : 'any workspace member';
}
