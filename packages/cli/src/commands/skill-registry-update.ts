import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import type { UpdateSkillRegistryInput } from '@mediforce/platform-core';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce skill-registry update <id> [options]

Update fields on an existing skill registry. All field flags are optional —
omit a flag to leave that field unchanged.

Positional:
  <id>                 Skill registry ID

Optional flags:
  --name <name>        Update the human-readable label
  --repo <url>         Update the repository URL (must pair with --commit)
  --commit <sha>       Update the commit SHA (must pair with --repo)
  --skills-dir <dir>   Update the skills directory path
  --namespace <ns>     Update the workspace namespace
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const UPDATE_OPTIONS = {
  name: { type: 'string' },
  repo: { type: 'string' },
  commit: { type: 'string' },
  'skills-dir': { type: 'string' },
  namespace: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function skillRegistryUpdateCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    name?: string;
    repo?: string;
    commit?: string;
    'skills-dir'?: string;
    namespace?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: UPDATE_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce skill-registry update: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const id = positionals[0];
  if (typeof id !== 'string' || id.length === 0) {
    printError(input.output, { error: '<id> is required' }, jsonMode);
    return 2;
  }

  const repoProvided = typeof flags.repo === 'string' && flags.repo.length > 0;
  const commitProvided = typeof flags.commit === 'string' && flags.commit.length > 0;
  if (repoProvided !== commitProvided) {
    printError(
      input.output,
      { error: '--repo and --commit must be provided together' },
      jsonMode,
    );
    return 2;
  }

  const updateBody: UpdateSkillRegistryInput = {};
  if (typeof flags.name === 'string' && flags.name.length > 0) {
    updateBody.name = flags.name;
  }
  if (repoProvided && commitProvided) {
    updateBody.repo = { url: flags.repo as string, commit: flags.commit as string };
  }
  if (typeof flags['skills-dir'] === 'string' && flags['skills-dir'].length > 0) {
    updateBody.skillsDir = flags['skills-dir'];
  }
  if (typeof flags.namespace === 'string' && flags.namespace.length > 0) {
    printError(
      input.output,
      {
        error:
          '--namespace is not patchable. Namespace transfers would let a caller relocate a ' +
          'registry into a workspace they do not control. Recreate the registry under the new ' +
          'namespace instead.',
      },
      jsonMode,
    );
    return 2;
  }

  if (Object.keys(updateBody).length === 0) {
    printError(
      input.output,
      { error: 'at least one field flag must be provided (--name, --repo+--commit, --skills-dir)' },
      jsonMode,
    );
    return 2;
  }

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const result = await mediforce.skillRegistries.update({ id }, updateBody);
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(`Updated skill registry ${result.skillRegistry.id}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof ApiError) {
      printError(
        input.output,
        { error: err.message, status: err.status, body: err.body },
        jsonMode,
      );
    } else {
      printError(input.output, { error: String(err) }, jsonMode);
    }
    return 1;
  }
}
