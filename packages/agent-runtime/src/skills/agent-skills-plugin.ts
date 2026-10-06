import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Skill } from '@mediforce/platform-core';
import { assertContainedPath } from '../plugins/workflow-artifacts';

const AGENT_SKILLS_CACHE_DIR = join(tmpdir(), 'mediforce-agent-skills');

/** Written when the step brings no plugin manifest of its own. */
const PLUGIN_MANIFEST = { name: 'mediforce-agent-skills' };

/** Bumped when the folder layout changes, so no folder of an older layout is reused. */
const LAYOUT_VERSION = 1;

/** What a step's plugin root contributes besides its skills. Only these are
 *  copied: the root is the parent of `skillsDir`, which for a repo checkout or
 *  the git skills cache holds far more than a plugin. */
const STEP_PLUGIN_PARTS = ['.claude-plugin', 'commands', 'agents', 'hooks'];

/** A plugin folder holding an agent's Skills, merged with the step's own. */
export interface AgentSkillsPlugin {
  /** Host path of the plugin root, ready for `pluginDir`. */
  dir: string;
  /** Ids of the agent's Skills left out because the step brings a skill of the same name. */
  clashes: string[];
}

function byPath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Every file under `path` as `[relative path, sha256]`, sorted, so the same
 *  tree always hashes the same however the file system orders it. Follows
 *  symlinks, as the copy does. */
async function treeDigest(path: string, prefix = ''): Promise<[string, string][]> {
  const target = prefix === '' ? path : join(path, prefix);
  if ((await stat(target)).isDirectory() === false) {
    return [[prefix, createHash('sha256').update(await readFile(target)).digest('hex')]];
  }
  const files: [string, string][] = [];
  for (const name of await readdir(target)) {
    files.push(...await treeDigest(path, prefix === '' ? name : `${prefix}/${name}`));
  }
  return files.sort(([left], [right]) => byPath(left, right));
}

/** The step's half of the merge: its skills folder and the plugin parts beside
 *  it. A skills folder that is not there contributes nothing. */
function stepSources(stepSkillsDir: string | null): { skillsDir: string; parts: string[] } | null {
  if (stepSkillsDir === null || existsSync(stepSkillsDir) === false) return null;
  const root = dirname(stepSkillsDir);
  return {
    skillsDir: stepSkillsDir,
    parts: STEP_PLUGIN_PARTS.map((part) => join(root, part)).filter((part) => existsSync(part)),
  };
}

/** Skill files are text an agent reads; only `scripts/` is meant to be run. */
function fileMode(path: string): number {
  return path.startsWith('scripts/') ? 0o755 : 0o644;
}

/**
 * Write an agent's Skills as a Claude Code plugin folder (ADR-0025 decision 6)
 * and return it:
 *
 *   <hash>/.claude-plugin/plugin.json
 *   <hash>/skills/<skill-id>/...
 *
 * When the step has a skills folder of its own (`stepSkillsDir`, the host path
 * `resolveSkillsDir` gives), its skills land under `skills/`, and the manifest,
 * commands, agents and hooks of the plugin root above it are kept. The step's
 * skill wins a name clash; the agent's is left out and reported.
 *
 * The folder is named by a hash of everything that goes into it — each Skill's
 * stored content hash and the step's files — so the same inputs share one
 * folder and an edit gets a new one instead of overwriting what a running step
 * has mounted. It is staged and renamed into place, so a concurrent step or a
 * killed process never leaves a half-written folder at that name.
 */
export async function materializeAgentSkillsPlugin(
  skills: readonly Skill[],
  stepSkillsDir: string | null,
): Promise<AgentSkillsPlugin> {
  const step = stepSources(stepSkillsDir);
  const clashes = skills
    .map((skill) => skill.id)
    .filter((id) => step !== null && existsSync(join(step.skillsDir, id)));

  const key = JSON.stringify({
    layout: LAYOUT_VERSION,
    manifest: PLUGIN_MANIFEST,
    skills: [...skills]
      .map((skill) => [skill.namespace, skill.id, skill.contentHash])
      .sort(([, left], [, right]) => byPath(left ?? '', right ?? '')),
    step: step === null ? null : {
      parts: await Promise.all(step.parts.map(async (part) => [basename(part), await treeDigest(part)])),
      skills: await treeDigest(step.skillsDir),
    },
  });
  const dir = join(AGENT_SKILLS_CACHE_DIR, createHash('sha256').update(key).digest('hex').slice(0, 16));
  if (existsSync(dir)) return { dir, clashes };

  await mkdir(AGENT_SKILLS_CACHE_DIR, { recursive: true });
  const staging = await mkdtemp(join(AGENT_SKILLS_CACHE_DIR, '.staging-'));
  try {
    if (step !== null) {
      for (const part of step.parts) {
        await cp(part, join(staging, basename(part)), { recursive: true, dereference: true });
      }
      await cp(step.skillsDir, join(staging, 'skills'), { recursive: true, dereference: true });
    }
    const manifest = join(staging, '.claude-plugin', 'plugin.json');
    if (existsSync(manifest) === false) {
      await mkdir(dirname(manifest), { recursive: true });
      await writeFile(manifest, `${JSON.stringify(PLUGIN_MANIFEST)}\n`);
    }
    for (const skill of skills) {
      if (clashes.includes(skill.id)) continue;
      const owner = `skill '${skill.namespace}/${skill.id}'`;
      assertContainedPath(skill.id, 'skill id', 'the plugin folder');
      for (const file of skill.files) {
        assertContainedPath(file.path, 'skill file', owner);
        const target = join(staging, 'skills', skill.id, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.contents, { mode: fileMode(file.path) });
      }
    }

    try {
      await rename(staging, dir);
    } catch (error) {
      // A concurrent step with the same inputs got there first; its folder
      // holds the same files by construction.
      if (existsSync(dir) === false) throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { dir, clashes };
}
