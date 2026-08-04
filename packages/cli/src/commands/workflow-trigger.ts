import { readFile, writeFile } from 'node:fs/promises';
import { isJsonObject, TriggerConfigFileSchema, type TriggerConfigFile } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

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
  description: "Trigger type: 'cron', 'manual', or 'webhook'",
} as const;
const scheduleUpdateArg = {
  type: 'string',
  required: false,
  description: '5-field cron schedule (UTC; minutes must be :00/:15/:30/:45)',
} as const;
const payloadArg = {
  type: 'string',
  required: false,
  description:
    "JSON object of static input every tick hands the run, e.g. '{\"region\":\"eu\"}'. Must satisfy the workflow's triggerInput. Cron only; pass '{}' to clear",
} as const;
const scheduleOptArg = {
  type: 'string',
  required: false,
  description: '5-field cron schedule (UTC; :00/:15/:30/:45). Required for --type cron, omit otherwise',
} as const;
const methodArg = {
  type: 'string',
  required: false,
  description: 'Webhook HTTP method — only POST is supported; defaults to POST when omitted',
} as const;
const pathArg = {
  type: 'string',
  required: false,
  description: 'URL path, leading slash (e.g. /orders). Required for --type webhook',
} as const;

/** Parse a `--payload` argument. Returns `undefined` when the flag was omitted
 *  (leave the payload alone) and an error string when it isn't a JSON object —
 *  the contract maps top-level keys to `triggerInput` fields, so an array or a
 *  scalar has nothing to map. */
function parsePayload(raw: unknown): { payload?: Record<string, unknown> } | { error: string } {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `--payload is not valid JSON: ${String(err)}` };
  }
  if (isJsonObject(parsed) === false) {
    return { error: '--payload must be a JSON object whose keys are triggerInput field names' };
  }
  return { payload: parsed };
}

/** One-line rendering of a trigger's config. Cron rows include their static
 *  payload, because two schedules on one workflow are only distinguishable by it
 *  (`nightly-us` vs `nightly-eu`) — a list that shows the cadence alone makes
 *  them look identical. */
function configOf(trigger: { type: string; config: unknown }): string {
  if (trigger.type === 'cron') {
    const config = trigger.config as { schedule: string; payload?: Record<string, unknown> };
    const hasPayload = config.payload !== undefined && Object.keys(config.payload).length > 0;
    return hasPayload ? `${config.schedule}  ${JSON.stringify(config.payload)}` : config.schedule;
  }
  if (trigger.type === 'webhook') {
    const config = trigger.config as { method: string; path: string };
    return `${config.method} ${config.path}`;
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
        output.stdout(`${state}  ${t.type}  ${t.name}  ${configOf(t)}`.trimEnd());
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
    schedule: scheduleOptArg,
    payload: payloadArg,
    method: methodArg,
    path: pathArg,
    namespace: namespaceArg,
    type: typeArg,
  },
  async run({ args, output, mediforce, jsonMode }) {
    const type = (args.type ?? 'cron') as 'cron' | 'manual' | 'webhook';
    const parsed = parsePayload(args.payload);
    if ('error' in parsed) {
      printError(output, { error: parsed.error }, jsonMode);
      return 1;
    }
    const result = await mediforce.triggers.create({
      definitionName: args.name,
      triggerName: args.trigger!,
      type,
      ...(args.schedule ? { schedule: args.schedule } : {}),
      ...(parsed.payload === undefined ? {} : { payload: parsed.payload }),
      ...(args.method ? { method: args.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' } : {}),
      ...(args.path ? { path: args.path } : {}),
      namespace: args.namespace!,
      enabled: true,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      const detail = configOf(result.trigger);
      const suffix = detail.length > 0 ? ` (${detail})` : '';
      output.stdout(
        `Added ${result.trigger.type} trigger '${result.trigger.name}'${suffix} to '${args.name}'`,
      );
      if (result.webhookUrl !== null) {
        output.stdout(`  URL: ${result.webhookUrl}`);
      }
    }
    return 0;
  },
});

export const workflowTriggerUpdateCommand = defineCommand({
  name: 'mediforce workflow trigger-update',
  description:
    "Change an existing cron trigger's schedule, its static payload, or both.",
  args: {
    name: nameArg,
    trigger: triggerArg,
    schedule: scheduleUpdateArg,
    payload: payloadArg,
    namespace: namespaceArg,
  },
  async run({ args, output, mediforce, jsonMode }) {
    const parsed = parsePayload(args.payload);
    if ('error' in parsed) {
      printError(output, { error: parsed.error }, jsonMode);
      return 1;
    }
    if (args.schedule === undefined && parsed.payload === undefined) {
      printError(output, { error: 'Pass --schedule, --payload, or both' }, jsonMode);
      return 1;
    }
    const result = await mediforce.triggers.update({
      definitionName: args.name,
      triggerName: args.trigger!,
      ...(args.schedule ? { schedule: args.schedule } : {}),
      ...(parsed.payload === undefined ? {} : { payload: parsed.payload }),
      namespace: args.namespace!,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Updated trigger '${result.trigger.name}' (${configOf(result.trigger)})`);
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

export const workflowTriggerExportCommand = defineCommand({
  name: 'mediforce workflow trigger-export',
  description:
    'Export a workflow\'s triggers to a portable trigger-config file (instance-free). Writes to --out or, when omitted, prints the JSON to stdout.',
  args: {
    name: nameArg,
    namespace: namespaceArg,
    out: { type: 'string', required: false, description: 'File to write the trigger config to (default: stdout)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.triggers.export({
      definitionName: args.name,
      namespace: args.namespace!,
    });
    const serialized = `${JSON.stringify(result.triggers, null, 2)}\n`;
    if (typeof args.out === 'string' && args.out.length > 0) {
      await writeFile(args.out, serialized, 'utf-8');
      if (jsonMode) {
        printJson(output, result);
      } else {
        output.stdout(
          `Exported ${String(result.triggers.length)} trigger(s) from '${args.name}' to ${args.out}`,
        );
      }
      return 0;
    }
    // No --out: emit the file contents to stdout so it can be piped/redirected.
    output.stdout(serialized.trimEnd());
    return 0;
  },
});

export const workflowTriggerImportCommand = defineCommand({
  name: 'mediforce workflow trigger-import',
  description:
    'Import triggers from a portable trigger-config file into a workflow. Skips names that already exist unless --replace is set. Webhook URLs re-derive for this host and cron cursors anchor to now.',
  args: {
    name: nameArg,
    file: { type: 'positional', required: true, description: 'Path to the trigger-config JSON file' },
    namespace: namespaceArg,
    replace: { type: 'boolean', description: 'Overwrite triggers whose name already exists' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    let raw: string;
    try {
      raw = await readFile(args.file as string, 'utf-8');
    } catch (err) {
      printError(output, { error: `Failed to read file: ${String(args.file)} — ${String(err)}` }, jsonMode);
      return 1;
    }

    let triggers: TriggerConfigFile;
    try {
      const parsed = TriggerConfigFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        printError(output, { error: 'Invalid trigger-config file', body: parsed.error.issues }, jsonMode);
        return 1;
      }
      triggers = parsed.data;
    } catch (err) {
      printError(output, { error: `Invalid JSON: ${String(err)}` }, jsonMode);
      return 1;
    }

    const result = await mediforce.triggers.import({
      definitionName: args.name,
      namespace: args.namespace!,
      triggers,
      replace: args.replace === true,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      for (const r of result.results) {
        const suffix = r.webhookUrl !== null ? ` — URL: ${r.webhookUrl}` : '';
        output.stdout(`${r.outcome}  ${r.type}  ${r.name}${suffix}`);
      }
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
