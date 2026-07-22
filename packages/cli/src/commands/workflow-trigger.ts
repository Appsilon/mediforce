import { defineCommand } from '../define-command';
import { printJson } from '../output';

const nameArg = {
  type: 'positional',
  required: true,
  description: 'Workflow definition name',
} as const;
const triggerArg = { type: 'string', required: true, description: 'Trigger name' } as const;
const namespaceArg = { type: 'string', required: true, description: 'Workspace handle' } as const;
const typeArg = {
  type: 'string',
  required: false,
  default: 'cron',
  description: 'Trigger type (cron only for now)',
} as const;
const scheduleArg = {
  type: 'string',
  required: true,
  description: '5-field cron schedule (UTC; minutes must be :00/:15/:30/:45)',
} as const;

function scheduleOf(trigger: { type: string; config: unknown }): string {
  if (trigger.type === 'cron') {
    return (trigger.config as { schedule: string }).schedule;
  }
  return '';
}

export const workflowTriggerListCommand = defineCommand({
  name: 'mediforce workflow trigger-list',
  description: 'List the triggers attached to a workflow.',
  args: { name: nameArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.list({
      definitionName: args.name,
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else if (result.triggers.length === 0) {
      output.stdout(`No triggers for '${args.name}'`);
    } else {
      for (const t of result.triggers) {
        const state = t.enabled ? 'enabled ' : 'disabled';
        output.stdout(`${state}  ${t.type}  ${t.name}  ${scheduleOf(t)}`.trimEnd());
      }
    }
    return 0;
  },
});

export const workflowTriggerAddCommand = defineCommand({
  name: 'mediforce workflow trigger-add',
  description: 'Add a trigger to a workflow (enabled by default).',
  args: {
    name: nameArg,
    trigger: triggerArg,
    schedule: scheduleArg,
    namespace: namespaceArg,
    type: typeArg,
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.create({
      definitionName: args.name,
      triggerName: args.trigger!,
      type: (args.type ?? 'cron') as 'cron',
      schedule: args.schedule!,
      namespace: args.namespace!,
      enabled: true,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Added ${result.trigger.type} trigger '${result.trigger.name}' (${scheduleOf(result.trigger)}) to '${args.name}'`,
      );
    }
    return 0;
  },
});

export const workflowTriggerUpdateCommand = defineCommand({
  name: 'mediforce workflow trigger-update',
  description: 'Change the schedule of an existing cron trigger.',
  args: { name: nameArg, trigger: triggerArg, schedule: scheduleArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.update({
      definitionName: args.name,
      triggerName: args.trigger!,
      schedule: args.schedule!,
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Updated trigger '${result.trigger.name}' schedule to '${scheduleOf(result.trigger)}'`,
      );
    }
    return 0;
  },
});

export const workflowTriggerStartCommand = defineCommand({
  name: 'mediforce workflow trigger-start',
  description: 'Start (enable) a trigger.',
  args: { name: nameArg, trigger: triggerArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.setEnabled({
      definitionName: args.name,
      triggerName: args.trigger!,
      namespace: args.namespace!,
      enabled: true,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Started trigger '${result.trigger.name}'`);
    }
    return 0;
  },
});

export const workflowTriggerStopCommand = defineCommand({
  name: 'mediforce workflow trigger-stop',
  description: 'Stop (disable) a trigger without deleting it.',
  args: { name: nameArg, trigger: triggerArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.setEnabled({
      definitionName: args.name,
      triggerName: args.trigger!,
      namespace: args.namespace!,
      enabled: false,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Stopped trigger '${result.trigger.name}'`);
    }
    return 0;
  },
});

export const workflowTriggerRemoveCommand = defineCommand({
  name: 'mediforce workflow trigger-remove',
  description: 'Delete a trigger.',
  args: { name: nameArg, trigger: triggerArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.delete({
      definitionName: args.name,
      triggerName: args.trigger!,
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Removed trigger '${args.trigger}' from '${args.name}'`);
    }
    return 0;
  },
});
