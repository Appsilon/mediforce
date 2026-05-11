import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import type { AgentSkillRef } from '@mediforce/platform-core';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce agent skill add <id> --skill <registryId>:<name> [options]

Bind one or more skills to an agent. Repeats: pass --skill multiple times.
Existing bindings on the agent are preserved; duplicates (same registryId +
name) are ignored. Mirrors \`git remote add\` semantics — additive, not
replace.

Positional:
  <id>                 Agent definition ID

Required flags:
  --skill <ref>        Skill binding in the form <registryId>:<name>.
                       Repeatable.

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const OPTIONS = {
  skill: { type: 'string', multiple: true },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function parseSkillRef(raw: string): AgentSkillRef | null {
  const sep = raw.indexOf(':');
  if (sep <= 0 || sep === raw.length - 1) return null;
  const registryId = raw.slice(0, sep);
  const name = raw.slice(sep + 1);
  if (registryId.length === 0 || name.length === 0) return null;
  return { registryId, name };
}

function sameRef(a: AgentSkillRef, b: AgentSkillRef): boolean {
  return a.registryId === b.registryId && a.name === b.name;
}

export async function agentSkillAddCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    skill?: string[];
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce agent skill add: ${String(err)}`);
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

  const rawSkills = flags.skill ?? [];
  if (rawSkills.length === 0) {
    printError(
      input.output,
      { error: 'at least one --skill <registryId>:<name> flag is required' },
      jsonMode,
    );
    return 2;
  }

  const toAdd: AgentSkillRef[] = [];
  for (const raw of rawSkills) {
    const parsed = parseSkillRef(raw);
    if (parsed === null) {
      printError(
        input.output,
        { error: `invalid --skill value "${raw}" — expected <registryId>:<name>` },
        jsonMode,
      );
      return 2;
    }
    toAdd.push(parsed);
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
    const existing = await mediforce.agents.get({ id });
    const current: AgentSkillRef[] = existing.agent.skills ?? [];
    const merged: AgentSkillRef[] = [...current];
    for (const ref of toAdd) {
      if (!merged.some((r) => sameRef(r, ref))) merged.push(ref);
    }
    const result = await mediforce.agents.updateSkills({ id }, { skills: merged });
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(
        `Added ${String(toAdd.length)} skill(s) to agent ${id} (total: ${String(merged.length)})`,
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
