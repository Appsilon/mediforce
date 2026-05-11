import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce skill-registry create --name <name> --repo <url> --commit <sha> --skills-dir <dir> [options]

Create a new skill registry.

Required flags:
  --name <name>        Human-readable label (e.g. "SDTM skills")
  --namespace <ns>     Workspace namespace that owns the registry
  --repo <url>         Git repository URL (https or file://)
  --commit <sha>       40-character commit SHA pinning the registry
  --skills-dir <dir>   Path within the repo containing skill folders

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const CREATE_OPTIONS = {
  name: { type: 'string' },
  repo: { type: 'string' },
  commit: { type: 'string' },
  'skills-dir': { type: 'string' },
  namespace: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function skillRegistryCreateCommand(input: CommandInput): Promise<number> {
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
      options: CREATE_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce skill-registry create: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const name = flags.name;
  const repoUrl = flags.repo;
  const commit = flags.commit;
  const skillsDir = flags['skills-dir'];

  if (typeof name !== 'string' || name.length === 0) {
    printError(input.output, { error: '--name is required' }, jsonMode);
    return 2;
  }
  if (typeof repoUrl !== 'string' || repoUrl.length === 0) {
    printError(input.output, { error: '--repo is required' }, jsonMode);
    return 2;
  }
  if (typeof commit !== 'string' || commit.length === 0) {
    printError(input.output, { error: '--commit is required' }, jsonMode);
    return 2;
  }
  if (typeof skillsDir !== 'string' || skillsDir.length === 0) {
    printError(input.output, { error: '--skills-dir is required' }, jsonMode);
    return 2;
  }
  const namespace = flags.namespace;
  if (typeof namespace !== 'string' || namespace.length === 0) {
    printError(input.output, { error: '--namespace is required' }, jsonMode);
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
    const result = await mediforce.skillRegistries.create({
      name,
      namespace,
      repo: { url: repoUrl, commit },
      skillsDir,
    });
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(
        `Created skill registry ${result.skillRegistry.id} (${result.skillRegistry.name})`,
      );
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
