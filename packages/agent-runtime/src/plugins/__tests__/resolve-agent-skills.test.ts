import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { addCommitToTestRepo, createTestRepo, type TestRepo } from './helpers/create-test-repo.js';

// Phase 0 RED — pins the Registry-first assembly contract.
// `resolveAgentSkills` does not exist yet on main; the dynamic import will
// fail at runtime (module not found) and the test fails. After Phase 2 it
// should resolve and assert correctly.

interface ResolvedAgentSkills {
  pluginDir: string;
  skills: Array<{ name: string; description: string }>;
}

interface SkillRegistryRecord {
  id: string;
  name: string;
  repo: { url: string; commit: string; auth?: string };
  skillsDir: string;
}

interface ResolveAgentSkillsModule {
  resolveAgentSkills: (
    agentSkills: Array<{ registryId: string; name: string }>,
    registries: Map<string, SkillRegistryRecord>,
  ) => Promise<ResolvedAgentSkills>;
}

function loadModule(): Promise<ResolveAgentSkillsModule> {
  // Indirect path so tsc does not statically resolve it; missing module
  // throws ERR_MODULE_NOT_FOUND at runtime, which is the RED signal.
  const path = '../resolve-agent-skills';
  return import(path) as Promise<ResolveAgentSkillsModule>;
}

const SDTM_SKILL = `---
name: sdtmig-reference
description: Reference SDTMIG variable conformance lookup
---

# SDTMIG Reference

Use lookup.py to query the CSV.
`;

const STYLE_SKILL = `---
name: style-guide
description: Workspace style guide for output formatting
---

# Style Guide

Follow these conventions.
`;

describe('resolveAgentSkills — Registry-first assembly (Phase 0 RED, target Phase 2)', () => {
  let repoA: TestRepo;
  let repoB: TestRepo;
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    repoA = createTestRepo();
    repoB = createTestRepo();
  });

  afterEach(() => {
    repoA.cleanup();
    repoB.cleanup();
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it('[DATA] assembles a per-run plugin dir with skills from two registries', async () => {
    const shaA = addCommitToTestRepo(repoA.repoPath, {
      'skills/sdtmig-reference/SKILL.md': SDTM_SKILL,
      'skills/sdtmig-reference/lookup.py': '#!/usr/bin/env python3\nprint("ok")\n',
      'skills/sdtmig-reference/references/sdtmig.csv': 'TERM,DOMAIN\nAESER,AE\n',
    });
    const shaB = addCommitToTestRepo(repoB.repoPath, {
      'skills/style-guide/SKILL.md': STYLE_SKILL,
    });

    const registries = new Map<string, SkillRegistryRecord>([
      ['reg-a', { id: 'reg-a', name: 'SDTM skills', repo: { url: `file://${repoA.repoPath}`, commit: shaA }, skillsDir: 'skills' }],
      ['reg-b', { id: 'reg-b', name: 'Style', repo: { url: `file://${repoB.repoPath}`, commit: shaB }, skillsDir: 'skills' }],
    ]);

    const mod = await loadModule();
    expect(typeof mod.resolveAgentSkills).toBe('function');

    const result = await mod.resolveAgentSkills(
      [
        { registryId: 'reg-a', name: 'sdtmig-reference' },
        { registryId: 'reg-b', name: 'style-guide' },
      ],
      registries,
    );
    cleanupDirs.push(result.pluginDir);

    expect(typeof result.pluginDir).toBe('string');
    expect(existsSync(join(result.pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(result.pluginDir, 'skills', 'sdtmig-reference', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(result.pluginDir, 'skills', 'sdtmig-reference', 'lookup.py'))).toBe(true);
    expect(existsSync(join(result.pluginDir, 'skills', 'sdtmig-reference', 'references', 'sdtmig.csv'))).toBe(true);
    expect(existsSync(join(result.pluginDir, 'skills', 'style-guide', 'SKILL.md'))).toBe(true);

    // Frontmatter description parsed for OpenCode prompt index.
    const skillNames = result.skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['sdtmig-reference', 'style-guide']);
    const sdtm = result.skills.find((s) => s.name === 'sdtmig-reference');
    expect(sdtm?.description).toContain('SDTMIG');
  });

  it('[DATA] errors when a referenced registry is missing', async () => {
    const shaA = addCommitToTestRepo(repoA.repoPath, {
      'skills/sdtmig-reference/SKILL.md': SDTM_SKILL,
    });
    const registries = new Map<string, SkillRegistryRecord>([
      ['reg-a', { id: 'reg-a', name: 'SDTM skills', repo: { url: `file://${repoA.repoPath}`, commit: shaA }, skillsDir: 'skills' }],
    ]);

    const mod = await loadModule();
    await expect(
      mod.resolveAgentSkills(
        [{ registryId: 'missing', name: 'whatever' }],
        registries,
      ),
    ).rejects.toThrow(/registry/i);
  });

  it('[DATA] errors when a skill folder is not present at the registry SHA', async () => {
    const shaA = addCommitToTestRepo(repoA.repoPath, {
      'skills/sdtmig-reference/SKILL.md': SDTM_SKILL,
    });
    const registries = new Map<string, SkillRegistryRecord>([
      ['reg-a', { id: 'reg-a', name: 'SDTM skills', repo: { url: `file://${repoA.repoPath}`, commit: shaA }, skillsDir: 'skills' }],
    ]);

    const mod = await loadModule();
    await expect(
      mod.resolveAgentSkills(
        [{ registryId: 'reg-a', name: 'does-not-exist' }],
        registries,
      ),
    ).rejects.toThrow(/skill|not found/i);
  });

  it('[DATA] reuses the fetchSkillsFromRepo cache — second call returns same on-disk skills', async () => {
    const shaA = addCommitToTestRepo(repoA.repoPath, {
      'skills/sdtmig-reference/SKILL.md': SDTM_SKILL,
      'skills/sdtmig-reference/lookup.py': 'print("v1")\n',
    });
    const registries = new Map<string, SkillRegistryRecord>([
      ['reg-a', { id: 'reg-a', name: 'SDTM skills', repo: { url: `file://${repoA.repoPath}`, commit: shaA }, skillsDir: 'skills' }],
    ]);

    const mod = await loadModule();
    const first = await mod.resolveAgentSkills(
      [{ registryId: 'reg-a', name: 'sdtmig-reference' }],
      registries,
    );
    cleanupDirs.push(first.pluginDir);
    const second = await mod.resolveAgentSkills(
      [{ registryId: 'reg-a', name: 'sdtmig-reference' }],
      registries,
    );
    cleanupDirs.push(second.pluginDir);

    // Per-run plugin dirs differ; cached skills bytes are identical.
    expect(first.pluginDir).not.toBe(second.pluginDir);
    const a = readFileSync(join(first.pluginDir, 'skills', 'sdtmig-reference', 'lookup.py'), 'utf-8');
    const b = readFileSync(join(second.pluginDir, 'skills', 'sdtmig-reference', 'lookup.py'), 'utf-8');
    expect(a).toBe(b);
  });
});
