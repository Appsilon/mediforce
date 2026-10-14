import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Skill } from '@mediforce/platform-core';
import { assertContainedPath } from '../plugins/workflow-artifacts';

const AGENT_SKILLS_CACHE_DIR = join(tmpdir(), 'mediforce-agent-skills');

/** The manifest Claude Code reads from `.claude-plugin/plugin.json`. */
const PLUGIN_MANIFEST = { name: 'mediforce-agent-skills' };

/** Bumped when the folder layout changes, so no folder of an older layout is reused. */
const LAYOUT_VERSION = 1;

function byPath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Skill files are text an agent reads; only `scripts/` is meant to be run. */
function fileMode(path: string): number {
  return path.startsWith('scripts/') ? 0o755 : 0o644;
}

/**
 * Write a step's Skills (its agent's and its own, ADR-0027) as a Claude Code
 * plugin folder (ADR-0025 decision 6) and return its host path:
 *
 *   <hash>/.claude-plugin/plugin.json
 *   <hash>/skills/<skill-id>/...
 *
 * The folder is named by a hash of each Skill's stored content hash, so the
 * same Skills share one folder and an edit gets a new one instead of
 * overwriting what a running step has mounted. It is staged and renamed into
 * place, so a concurrent step or a killed process never leaves a half-written
 * folder at that name.
 */
export async function materializeAgentSkillsPlugin(skills: readonly Skill[]): Promise<string> {
  const key = JSON.stringify({
    layout: LAYOUT_VERSION,
    manifest: PLUGIN_MANIFEST,
    skills: [...skills]
      .map((skill) => [skill.namespace, skill.id, skill.contentHash])
      .sort(([, left], [, right]) => byPath(left ?? '', right ?? '')),
  });
  const dir = join(AGENT_SKILLS_CACHE_DIR, createHash('sha256').update(key).digest('hex').slice(0, 16));
  if (existsSync(dir)) return dir;

  await mkdir(AGENT_SKILLS_CACHE_DIR, { recursive: true });
  const staging = await mkdtemp(join(AGENT_SKILLS_CACHE_DIR, '.staging-'));
  try {
    const manifest = join(staging, '.claude-plugin', 'plugin.json');
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, `${JSON.stringify(PLUGIN_MANIFEST)}\n`);
    for (const skill of skills) {
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
  return dir;
}
