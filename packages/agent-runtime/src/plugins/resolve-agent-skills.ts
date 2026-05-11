import { existsSync, mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentSkillRef } from '@mediforce/platform-core';
import { fetchSkillsCache } from './fetch-skills-cache.js';

export interface SkillRegistryRef {
  id: string;
  repo: { url: string; commit: string; auth?: string };
  skillsDir: string;
}

export interface ResolvedAgentSkill {
  name: string;
  description: string;
}

export interface ResolvedAgentSkills {
  /** Per-run plugin directory: `.claude-plugin/plugin.json` + `skills/<name>/` for each skill. */
  pluginDir: string;
  /** Skills with frontmatter description, in the order they were declared. */
  skills: ResolvedAgentSkill[];
}

const FRONTMATTER_DESCRIPTION = /^description:\s*(.+?)\s*$/m;

function parseFrontmatterDescription(skillMarkdown: string): string {
  if (!skillMarkdown.startsWith('---')) return '';
  const end = skillMarkdown.indexOf('\n---', 3);
  if (end === -1) return '';
  const block = skillMarkdown.slice(3, end);
  const match = block.match(FRONTMATTER_DESCRIPTION);
  if (match === null) return '';
  return match[1].trim();
}

/**
 * Build a per-run plugin directory from a list of agent skill references and
 * a Map<registryId, registry>. Each entry resolves to
 * `<registry.repo>@<commit>:<registry.skillsDir>/<name>/` which is fetched
 * (cache key = sha256(repoUrl + commit + skillsDir)) and copied into
 * `tmp/agent-plugin-XXXX/skills/<name>/`. A synthesized
 * `.claude-plugin/plugin.json` lives at the root so Claude Code's
 * `--plugin-dir` discovery activates each skill's `SKILL.md` natively.
 *
 * Throws when a referenced registry is missing or a skill folder is not
 * present at the resolved SHA — both are user-recoverable misconfigurations
 * that should fail the run rather than be silently ignored.
 */
export async function resolveAgentSkills(
  agentSkills: readonly AgentSkillRef[],
  registries:
    | Map<string, SkillRegistryRef>
    | { getById(id: string): Promise<SkillRegistryRef | null> },
): Promise<ResolvedAgentSkills> {
  const lookup = async (registryId: string): Promise<SkillRegistryRef | null> => {
    if (registries instanceof Map) {
      return registries.get(registryId) ?? null;
    }
    return registries.getById(registryId);
  };

  const pluginDir = mkdtempSync(join(tmpdir(), 'mediforce-agent-plugin-'));
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(pluginDir, 'skills'), { recursive: true });

  const skills: ResolvedAgentSkill[] = [];

  for (const ref of agentSkills) {
    const registry = await lookup(ref.registryId);
    if (registry === null) {
      throw new Error(
        `Skill registry "${ref.registryId}" not found (referenced by skill "${ref.name}")`,
      );
    }

    const cachedSkillsDir = await fetchSkillsCache(
      registry.repo.url,
      registry.repo.commit,
      registry.skillsDir,
      registry.repo.auth,
    );
    const sourceSkillDir = join(cachedSkillsDir, ref.name);
    if (!existsSync(sourceSkillDir)) {
      throw new Error(
        `Skill "${ref.name}" not found in registry "${ref.registryId}" at ` +
          `${registry.repo.url}@${registry.repo.commit.slice(0, 8)}:${registry.skillsDir}/`,
      );
    }

    const destSkillDir = join(pluginDir, 'skills', ref.name);
    cpSync(sourceSkillDir, destSkillDir, { recursive: true });

    const skillMdPath = join(destSkillDir, 'SKILL.md');
    let description = '';
    if (existsSync(skillMdPath)) {
      const raw = readFileSync(skillMdPath, 'utf-8');
      description = parseFrontmatterDescription(raw);
    }
    skills.push({ name: ref.name, description });
  }

  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name: 'agent-skills',
        version: '0.0.0',
        description: 'Per-run plugin assembled from agent.skills registries',
      },
      null,
      2,
    ),
  );

  return { pluginDir, skills };
}
