import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureOutput, jsonResponse } from './test-helpers.js';

// Phase 0 RED — pins the CLI dogfooding contract for the new
// `mediforce skill-registry ...` and `mediforce agent --skill ...` flags
// (AGENTS.md §3 — "Dogfood the CLI"). Today neither command exists; the
// dynamic imports throw and the tests fail.

interface CliCommand {
  (args: {
    argv: string[];
    env: Record<string, string>;
    output: ReturnType<typeof captureOutput>;
  }): Promise<number>;
}

interface SkillRegistryListModule {
  skillRegistryListCommand: CliCommand;
}

interface SkillRegistryCreateModule {
  skillRegistryCreateCommand: CliCommand;
}

interface AgentUpdateModule {
  agentUpdateCommand: CliCommand;
}

async function loadDynamic<T>(specifier: string): Promise<T> {
  return (await import(specifier)) as T;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mediforce skill-registry — Phase 0 RED, target Phase 1', () => {
  it('lists registries via GET /api/skill-registries', async () => {
    const mod = await loadDynamic<SkillRegistryListModule>('../commands/skill-registry-list.js');
    expect(typeof mod.skillRegistryListCommand).toBe('function');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        skillRegistries: [
          {
            id: 'reg-1',
            name: 'SDTM skills',
            repo: { url: 'file:///tmp/repo', commit: 'a'.repeat(40) },
            skillsDir: 'skills',
            createdAt: '2026-05-01T00:00:00Z',
            updatedAt: '2026-05-01T00:00:00Z',
          },
        ],
      }),
    );

    const output = captureOutput();
    const code = await mod.skillRegistryListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as {
      skillRegistries: Array<{ id: string; name: string }>;
    };
    expect(parsed.skillRegistries).toHaveLength(1);
    expect(parsed.skillRegistries[0].id).toBe('reg-1');
  });

  it('creates a registry via POST /api/skill-registries', async () => {
    const mod = await loadDynamic<SkillRegistryCreateModule>(
      '../commands/skill-registry-create.js',
    );
    expect(typeof mod.skillRegistryCreateCommand).toBe('function');

    let captured: { url: string; init: RequestInit } | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return jsonResponse({
        skillRegistry: {
          id: 'reg-new',
          name: 'SDTM skills',
          repo: { url: 'file:///tmp/repo', commit: 'b'.repeat(40) },
          skillsDir: 'skills',
        },
      }, 201);
    });

    const output = captureOutput();
    const code = await mod.skillRegistryCreateCommand({
      argv: [
        '--name', 'SDTM skills',
        '--repo', 'file:///tmp/repo',
        '--commit', 'b'.repeat(40),
        '--skills-dir', 'skills',
        '--json',
      ],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain('/api/skill-registries');
    expect(captured!.init.method).toBe('POST');
    const body = JSON.parse(captured!.init.body as string) as {
      name: string; repo: { url: string; commit: string }; skillsDir: string;
    };
    expect(body.name).toBe('SDTM skills');
    expect(body.skillsDir).toBe('skills');
  });
});

describe('mediforce agent update --skill — Phase 0 RED, target Phase 1', () => {
  it('PATCHes /api/agent-definitions/[id] with the new skills array', async () => {
    const mod = await loadDynamic<AgentUpdateModule>('../commands/agent-update.js');
    expect(typeof mod.agentUpdateCommand).toBe('function');

    let patchBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/api/agent-definitions/agent-1') && init?.method === 'PATCH') {
        patchBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return jsonResponse({ agent: { id: 'agent-1' } });
      }
      return jsonResponse({}, 404);
    });

    const output = captureOutput();
    const code = await mod.agentUpdateCommand({
      argv: [
        'agent-1',
        '--skill', 'reg-a:sdtmig-reference',
        '--skill', 'reg-b:style-guide',
        '--json',
      ],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(patchBody).not.toBeNull();
    const skills = (patchBody as unknown as { skills?: Array<{ registryId: string; name: string }> }).skills;
    expect(skills).toEqual([
      { registryId: 'reg-a', name: 'sdtmig-reference' },
      { registryId: 'reg-b', name: 'style-guide' },
    ]);
  });
});
