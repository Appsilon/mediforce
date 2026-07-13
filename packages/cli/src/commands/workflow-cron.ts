import { defineCommand } from '../define-command';
import { printJson } from '../output';

const nameArg = {
  type: 'positional',
  required: true,
  description: 'Workflow definition name',
} as const;
const triggerArg = { type: 'string', required: true, description: 'Cron trigger name' } as const;
const namespaceArg = { type: 'string', required: true, description: 'Workspace handle' } as const;
const scheduleArg = {
  type: 'string',
  required: true,
  description: '5-field cron schedule (UTC; minutes must be :00/:15/:30/:45)',
} as const;

export const workflowCronListCommand = defineCommand({
  name: 'mediforce workflow cron-list',
  description: 'List the cron triggers attached to a workflow.',
  args: { name: nameArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cronTriggers.list({
      definitionName: args.name,
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else if (result.triggers.length === 0) {
      output.stdout(`No cron triggers for '${args.name}'`);
    } else {
      for (const t of result.triggers) {
        const state = t.enabled ? 'enabled ' : 'disabled';
        output.stdout(`${state}  ${t.triggerName}  ${t.schedule}`);
      }
    }
    return 0;
  },
});

export const workflowCronAddCommand = defineCommand({
  name: 'mediforce workflow cron-add',
  description: 'Add a cron trigger to a workflow (enabled by default).',
  args: { name: nameArg, trigger: triggerArg, schedule: scheduleArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cronTriggers.create({
      definitionName: args.name,
      triggerName: args.trigger!,
      schedule: args.schedule!,
      namespace: args.namespace!,
      enabled: true,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Added cron trigger '${result.trigger.triggerName}' (${result.trigger.schedule}) to '${args.name}'`,
      );
    }
    return 0;
  },
});

export const workflowCronUpdateCommand = defineCommand({
  name: 'mediforce workflow cron-update',
  description: 'Change the schedule of an existing cron trigger.',
  args: { name: nameArg, trigger: triggerArg, schedule: scheduleArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cronTriggers.update({
      definitionName: args.name,
      triggerName: args.trigger!,
      schedule: args.schedule!,
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Updated cron trigger '${result.trigger.triggerName}' schedule to '${result.trigger.schedule}'`,
      );
    }
    return 0;
  },
});

export const workflowCronStartCommand = defineCommand({
  name: 'mediforce workflow cron-start',
  description: 'Start (enable) a cron trigger.',
  args: { name: nameArg, trigger: triggerArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cronTriggers.setEnabled({
      definitionName: args.name,
      triggerName: args.trigger!,
      namespace: args.namespace!,
      enabled: true,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Started cron trigger '${result.trigger.triggerName}'`);
    }
    return 0;
  },
});

export const workflowCronStopCommand = defineCommand({
  name: 'mediforce workflow cron-stop',
  description: 'Stop (disable) a cron trigger without deleting it.',
  args: { name: nameArg, trigger: triggerArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cronTriggers.setEnabled({
      definitionName: args.name,
      triggerName: args.trigger!,
      namespace: args.namespace!,
      enabled: false,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Stopped cron trigger '${result.trigger.triggerName}'`);
    }
    return 0;
  },
});

export const workflowCronRemoveCommand = defineCommand({
  name: 'mediforce workflow cron-remove',
  description: 'Delete a cron trigger.',
  args: { name: nameArg, trigger: triggerArg, namespace: namespaceArg },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cronTriggers.delete({
      definitionName: args.name,
      triggerName: args.trigger!,
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Removed cron trigger '${args.trigger}' from '${args.name}'`);
    }
    return 0;
  },
});
