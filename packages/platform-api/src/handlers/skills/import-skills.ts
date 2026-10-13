import {
  SKILL_MANIFEST_PATH,
  SkillFilesSchema,
  WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
  skillManifest,
  type SkillFile,
} from '@mediforce/platform-core';
import { ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { ImportSkillsInput, ImportSkillsOutput, ImportedSkill } from '../../contract/skills';
import { resolveGitHubSource } from '../workflows/_github';
import { assertClonableRepo } from '../_clonable-repo';
import { skillContentHash } from './_helpers';
import { createSkill } from './create-skill';
import { updateSkill } from './update-skill';

interface SkillFolderSource {
  /** Canonical repository URL. */
  repo: string;
  commit: string;
  /** Directory whose `<name>/SKILL.md` folders are Skills, from the repo root; `''` is the root. */
  dir: string;
}

/** `a/b/` and `/a/b` both mean `a/b`; a `..` segment is refused rather than resolved. */
export function normalizeRepoDir(dir: string | undefined): string {
  const segments = (dir ?? '').split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) throw new ValidationError(`Directory '${dir ?? ''}' climbs out of the repository`);
  return segments.join('/');
}

/**
 * Every `<dir>/<name>/` folder holding a `SKILL.md`, read at one commit through
 * one anonymous clone: a caller-named repository never spends the deployment's
 * own key. Hidden files (`.DS_Store`) are not part of a skill and are skipped,
 * as `mediforce skill create` skips them; a link, a binary file or one past the
 * Skill cap is refused by name. Each folder is checked as a Skill before
 * anything is written, so a bad folder imports nothing.
 */
export async function readSkillFolders(
  source: SkillFolderSource,
  scope: CallerScope,
): Promise<SkillFile[][]> {
  assertClonableRepo(source.repo);
  const prefix = source.dir === '' ? '' : `${source.dir}/`;
  const entries = await scope.system.repoFileReader.readDirectory({
    repo: source.repo,
    commit: source.commit,
    dir: source.dir,
    // One file may take the whole Skill cap; SkillFilesSchema checks the total.
    maxBytes: WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
    anonymousOnly: true,
  });

  const folders = new Map<string, SkillFile[]>();
  const refusals: string[] = [];
  for (const entry of entries) {
    const [folder, ...rest] = entry.path.slice(prefix.length).split('/');
    if (folder === undefined || rest.length === 0) continue;
    if ([folder, ...rest].some((segment) => segment.startsWith('.'))) continue;
    const path = rest.join('/');
    if ('contents' in entry) {
      folders.set(folder, [...(folders.get(folder) ?? []), { path, contents: entry.contents }]);
    } else if ('tooLarge' in entry) {
      refusals.push(`${entry.path} is over ${String(entry.maxBytes)} bytes`);
    } else {
      refusals.push(`${entry.path} is ${entry.refused === 'symlink' ? 'a symlink' : 'not UTF-8 text'}; a skill holds text files only`);
    }
  }

  const skillFolders = [...folders.entries()]
    .filter(([, files]) => files.some((file) => file.path === SKILL_MANIFEST_PATH))
    .sort(([left], [right]) => (left < right ? -1 : 1));
  const relevantRefusals = refusals.filter((refusal) =>
    skillFolders.some(([folder]) => refusal.startsWith(`${prefix}${folder}/`)));
  if (relevantRefusals.length > 0) {
    throw new ValidationError(`Cannot import skills: ${relevantRefusals.join('; ')}`);
  }

  const issues: string[] = [];
  const ids = new Map<string, string>();
  for (const [folder, files] of skillFolders) {
    const parsed = SkillFilesSchema.safeParse(files);
    if (parsed.success === false) {
      issues.push(`${prefix}${folder}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
      continue;
    }
    const { name } = skillManifest(files);
    const clash = ids.get(name);
    if (clash !== undefined) issues.push(`${prefix}${folder} and ${prefix}${clash} both name skill '${name}'`);
    ids.set(name, folder);
  }
  if (issues.length > 0) throw new ValidationError(`Cannot import skills: ${issues.join('; ')}`);
  return skillFolders.map(([, files]) => files);
}

/**
 * Write each folder as a Skill of `namespace`: create it, replace the files of
 * one whose content differs (keeping its visibility), or leave an identical one
 * alone. A re-import is how upstream changes are taken, so it updates rather
 * than refuses.
 */
export async function upsertSkills(
  namespace: string,
  folders: SkillFile[][],
  basis: string,
  scope: CallerScope,
): Promise<ImportedSkill[]> {
  const imported: ImportedSkill[] = [];
  for (const files of folders) {
    const { name: id } = skillManifest(files);
    const existing = await scope.skills.getById(namespace, id);
    if (existing === null) {
      await createSkill({ namespace, files }, scope, basis);
      imported.push({ id, outcome: 'created' });
    } else if (existing.contentHash === skillContentHash(files)) {
      imported.push({ id, outcome: 'unchanged' });
    } else {
      await updateSkill({ namespace, id, files }, scope, basis);
      imported.push({ id, outcome: 'updated' });
    }
  }
  return imported;
}

export async function importSkills(
  input: ImportSkillsInput,
  scope: CallerScope,
): Promise<ImportSkillsOutput> {
  scope.skills.assertCanWrite(input.namespace);
  const resolved = await resolveGitHubSource(input.repo, input.ref);
  const dir = normalizeRepoDir([resolved.pathPrefix, input.dir ?? ''].join('/'));
  const source = { repo: resolved.repo, commit: resolved.commit, dir };

  const folders = await readSkillFolders(source, scope);
  if (folders.length === 0) {
    throw new ValidationError(
      `No skill folders (<name>/${SKILL_MANIFEST_PATH}) under '${dir === '' ? '/' : dir}' in ${resolved.repo} at ${resolved.commit.slice(0, 8)}`,
    );
  }
  const skills = await upsertSkills(
    input.namespace,
    folders,
    `Skill imported from ${resolved.repo}@${resolved.commit}${dir === '' ? '' : ` (${dir})`}`,
    scope,
  );
  return { source: { url: resolved.repo, commit: resolved.commit, dir }, skills };
}
