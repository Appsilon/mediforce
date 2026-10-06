import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SkillVisibilitySchema, type SkillFile } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printError, printJson, type OutputSink } from '../output';

/**
 * `mediforce skill *` — the workspace's Skills (ADR-0025). A Skill is a
 * Claude Code skill folder; `create` / `update --from <dir>` upload one from
 * disk. Its id, name and description come from the folder's `SKILL.md`.
 */

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Read a skill folder into the `files[]` the API takes: every regular file
 * under `dir`, as a forward-slash path relative to it. Hidden entries
 * (`.git`, `.DS_Store`) are not part of a skill and are skipped. A symlink or a
 * file that is not UTF-8 text is refused by name — a Skill holds text only, and
 * a link could pull in content from outside the folder.
 */
export function readSkillFolder(dir: string): SkillFile[] {
  const files: SkillFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      if (entry.startsWith('.')) continue;
      const full = join(current, entry);
      const path = relative(dir, full).split(sep).join('/');
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) {
        throw new Error(`${path} is a symlink; a skill folder can only hold plain files and directories`);
      }
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      const bytes = readFileSync(full);
      let contents: string;
      try {
        contents = utf8.decode(bytes);
      } catch {
        throw new Error(`${path} is not UTF-8 text; a skill can only hold text files`);
      }
      files.push({ path, contents });
    }
  };
  walk(dir);
  return files;
}

const VISIBILITY_ARG = {
  type: 'string',
  description: 'private (default) or public',
} as const;

const VisibilityArgSchema = SkillVisibilitySchema.optional();

function readFolderOrReport(dir: string, output: OutputSink, jsonMode: boolean): SkillFile[] | null {
  try {
    return readSkillFolder(dir);
  } catch (error) {
    printError(output, { error: `failed to read ${dir}: ${error instanceof Error ? error.message : String(error)}` }, jsonMode);
    return null;
  }
}

export const skillListCommand = defineCommand({
  name: 'mediforce skill list',
  description: 'List the Skills in a workspace (its public ones, if you are not a member).',
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.skills.list({ namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.skills.length === 0) {
      output.stdout(`No skills in '${args.namespace}'.`);
      return 0;
    }
    output.stdout(`Skills in '${args.namespace}' (${String(result.skills.length)}):`);
    for (const skill of result.skills) {
      output.stdout(`  ${skill.id}  [${skill.visibility}, ${String(skill.paths.length)} file(s)]  — ${skill.description}`);
    }
    return 0;
  },
});

export const skillGetCommand = defineCommand({
  name: 'mediforce skill get',
  description: 'Show one Skill and its files. --json prints every file in full.',
  args: {
    id: { type: 'positional', required: true, description: 'Skill id (its SKILL.md name)' },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.skills.get({ namespace: args.namespace, id: args.id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const { skill } = result;
    output.stdout(`${skill.namespace}/${skill.id}  [${skill.visibility}]`);
    output.stdout(`  ${skill.description}`);
    output.stdout(`  content hash: ${skill.contentHash}`);
    output.stdout(`  updated:      ${skill.updatedAt}`);
    output.stdout('  files:');
    for (const file of skill.files) {
      output.stdout(`    ${file.path}  (${String(Buffer.byteLength(file.contents, 'utf8'))} bytes)`);
    }
    return 0;
  },
});

export const skillCreateCommand = defineCommand({
  name: 'mediforce skill create',
  description: 'Create a Skill from a local skill folder holding a SKILL.md.',
  args: {
    from: { type: 'string', required: true, description: 'Skill folder, e.g. skills/sdtm-mapping' },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    visibility: VISIBILITY_ARG,
  },
  async run({ args, output, mediforce, jsonMode }) {
    const visibility = VisibilityArgSchema.safeParse(args.visibility);
    if (visibility.success === false) {
      printError(output, { error: `--visibility must be 'private' or 'public', got '${String(args.visibility)}'` }, jsonMode);
      return 1;
    }
    const files = readFolderOrReport(args.from, output, jsonMode);
    if (files === null) return 1;
    const result = await mediforce.skills.create({
      namespace: args.namespace,
      files,
      ...(visibility.data === undefined ? {} : { visibility: visibility.data }),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Created skill '${result.skill.id}' in '${args.namespace}' (${String(files.length)} file(s), ${result.skill.visibility}).`);
    return 0;
  },
});

export const skillUpdateCommand = defineCommand({
  name: 'mediforce skill update',
  description: 'Replace a Skill\'s files from a local folder and/or change its visibility.',
  args: {
    id: { type: 'positional', required: true, description: 'Skill id (its SKILL.md name)' },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    from: { type: 'string', description: 'Skill folder whose files replace the stored ones' },
    visibility: VISIBILITY_ARG,
  },
  async run({ args, output, mediforce, jsonMode }) {
    const visibility = VisibilityArgSchema.safeParse(args.visibility);
    if (visibility.success === false) {
      printError(output, { error: `--visibility must be 'private' or 'public', got '${String(args.visibility)}'` }, jsonMode);
      return 1;
    }
    if (args.from === undefined && visibility.data === undefined) {
      printError(output, { error: 'Pass --from <dir>, --visibility, or both' }, jsonMode);
      return 1;
    }
    const files = args.from === undefined ? undefined : readFolderOrReport(args.from, output, jsonMode);
    if (files === null) return 1;
    const result = await mediforce.skills.update({
      namespace: args.namespace,
      id: args.id,
      ...(files === undefined ? {} : { files }),
      ...(visibility.data === undefined ? {} : { visibility: visibility.data }),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Updated skill '${result.skill.id}' in '${args.namespace}' (${result.skill.visibility}).`);
    return 0;
  },
});

export const skillDeleteCommand = defineCommand({
  name: 'mediforce skill delete',
  description: 'Delete a Skill.',
  args: {
    id: { type: 'positional', required: true, description: 'Skill id (its SKILL.md name)' },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    force: { type: 'boolean', description: 'Confirm deletion (required)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if (args.force !== true) {
      printError(output, { error: `Pass --force to delete skill '${args.id}' from '${args.namespace}'` }, jsonMode);
      return 1;
    }
    const result = await mediforce.skills.delete({ namespace: args.namespace, id: args.id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Deleted skill '${args.id}' from '${args.namespace}'.`);
    return 0;
  },
});
