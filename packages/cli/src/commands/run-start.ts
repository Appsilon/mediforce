import { readFile } from 'node:fs/promises';
import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce run start --workflow <name> [options]

Fire a manual trigger to start a new run for the named workflow definition.
The server picks the latest registered version unless --version is supplied.

Required flags:
  --workflow <name>      Workflow definition name (e.g. landing-zone-CDISCPILOT01)

Optional flags:
  --namespace <ns>      Namespace/workspace that owns the workflow
  --version <number>     Pin a specific definition version (default: latest)
  --trigger <name>       Trigger name (default: manual)
  --triggered-by <id>    Identifier recorded as the run's initiator
                         (default: mediforce-cli)
  --input <json>         Inline JSON payload passed as trigger input
  --input-file <path>    Read trigger input JSON from a file (use - for stdin)
  --base-url <url>       API base URL (default: http://localhost:9003)
  --json                 Emit JSON instead of human-readable output
  --help, -h             Show this help text

After start, follow the run with:
  mediforce run get <runId>
`;

export const runStartCommand = defineCommand({
  name: 'run start',
  help: HELP,
  options: {
    workflow: { type: 'string' },
    namespace: { type: 'string' },
    version: { type: 'string' },
    trigger: { type: 'string' },
    'triggered-by': { type: 'string' },
    input: { type: 'string' },
    'input-file': { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ flags, mediforce, output, jsonMode, stdin }) => {
    if (typeof flags.workflow !== 'string' || flags.workflow.length === 0) {
      printError(output, { error: '--workflow is required' }, jsonMode);
      output.stderr('');
      output.stderr(HELP);
      return 2;
    }

    let definitionVersion: number | undefined;
    if (typeof flags.version === 'string') {
      const parsedVersion = Number.parseInt(flags.version, 10);
      if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
        printError(
          output,
          { error: `--version must be a positive integer, got '${flags.version}'` },
          jsonMode,
        );
        return 2;
      }
      definitionVersion = parsedVersion;
    }

    if (typeof flags.input === 'string' && typeof flags['input-file'] === 'string') {
      printError(output, { error: 'Cannot use both --input and --input-file' }, jsonMode);
      return 2;
    }

    let payload: Record<string, unknown> | undefined;
    if (typeof flags.input === 'string') {
      try {
        payload = JSON.parse(flags.input) as Record<string, unknown>;
      } catch {
        printError(output, { error: `--input is not valid JSON: ${flags.input}` }, jsonMode);
        return 2;
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        printError(output, { error: '--input must be a JSON object' }, jsonMode);
        return 2;
      }
    } else if (typeof flags['input-file'] === 'string') {
      let raw: string;
      if (flags['input-file'] === '-') {
        if (!stdin) {
          printError(output, { error: 'stdin not available' }, jsonMode);
          return 2;
        }
        raw = await stdin();
      } else {
        try {
          raw = await readFile(flags['input-file'], 'utf-8');
        } catch (err) {
          printError(
            output,
            { error: `Cannot read --input-file '${flags['input-file']}': ${String(err)}` },
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
      namespace: flags.namespace,
      definitionName: flags.workflow,
      definitionVersion,
      triggerName: flags.trigger ?? 'manual',
      triggeredBy: flags['triggered-by'] ?? 'mediforce-cli',
      payload,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Run started`);
    output.stdout(`  instanceId: ${result.instanceId}`);
    output.stdout(`  status:     ${result.status}`);
    output.stdout('');
    output.stdout(`Follow with: mediforce run get ${result.instanceId}`);
    return 0;
  },
});
