import { readFile } from 'node:fs/promises';
import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

export const runStartCommand = defineCommand({
  name: 'mediforce run start',
  description: 'Fire a manual trigger to start a new run for the named workflow definition.',
  args: {
    workflow: {
      type: 'string',
      required: true,
      description: 'Workflow definition name (e.g. landing-zone-CDISCPILOT01)',
    },
    namespace: { type: 'string', description: 'Namespace/workspace that owns the workflow' },
    version: { type: 'string', description: 'Pin a specific definition version (default: latest)' },
    trigger: { type: 'string', description: 'Trigger name (default: manual)' },
    'triggered-by': {
      type: 'string',
      description: "Identifier recorded as the run's initiator (default: mediforce-cli)",
    },
    input: { type: 'string', description: 'Inline JSON payload passed as trigger input' },
    'input-file': {
      type: 'string',
      description: 'Read trigger input JSON from a file (use - for stdin)',
    },
  },
  async run({ args, output, stdin, mediforce, jsonMode }) {
    let definitionVersion: number | undefined;
    if (typeof args.version === 'string') {
      const parsedVersion = Number.parseInt(args.version, 10);
      if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
        printError(
          output,
          { error: `--version must be a positive integer, got '${args.version}'` },
          jsonMode,
        );
        return 2;
      }
      definitionVersion = parsedVersion;
    }

    if (args.input !== undefined && args['input-file'] !== undefined) {
      printError(
        output,
        { error: 'Flags are mutually exclusive: --input, --input-file' },
        jsonMode,
      );
      return 2;
    }

    let payload: Record<string, unknown> | undefined;
    if (typeof args.input === 'string') {
      try {
        payload = JSON.parse(args.input) as Record<string, unknown>;
      } catch {
        printError(output, { error: `--input is not valid JSON: ${args.input}` }, jsonMode);
        return 2;
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        printError(output, { error: '--input must be a JSON object' }, jsonMode);
        return 2;
      }
    } else if (typeof args['input-file'] === 'string') {
      let raw: string;
      if (args['input-file'] === '-') {
        if (typeof stdin !== 'function') {
          printError(output, { error: 'stdin not available' }, jsonMode);
          return 2;
        }
        raw = await stdin();
      } else {
        try {
          raw = await readFile(args['input-file'], 'utf-8');
        } catch (err) {
          printError(
            output,
            { error: `Cannot read --input-file '${args['input-file']}': ${String(err)}` },
            jsonMode,
          );
          return 2;
        }
      }
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        printError(output, { error: `--input-file contains invalid JSON` }, jsonMode);
        return 2;
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        printError(output, { error: '--input-file must contain a JSON object' }, jsonMode);
        return 2;
      }
    }

    const result = await mediforce.runs.start({
      namespace: args.namespace,
      definitionName: args.workflow,
      definitionVersion,
      triggerName: args.trigger ?? 'manual',
      triggeredBy: args['triggered-by'] ?? 'mediforce-cli',
      payload,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Run started`);
    output.stdout(`  instanceId: ${result.run.id}`);
    output.stdout(`  status:     ${result.run.status}`);
    output.stdout('');
    output.stdout(`Follow with: mediforce run get ${result.run.id}`);
    return 0;
  },
});
