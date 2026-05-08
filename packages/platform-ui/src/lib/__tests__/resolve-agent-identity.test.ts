import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentDefinition, AgentDefinitionRepository } from '@mediforce/platform-core';

const mockDownload = vi.fn();
const mockGetMetadata = vi.fn();
const mockFile = vi.fn(() => ({ download: mockDownload, getMetadata: mockGetMetadata }));
const mockBucket = vi.fn(() => ({ file: mockFile }));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: mockBucket }),
}));

import {
  resolveAgentIdentity,
  resolveAgentIdentityPrompt,
  downloadSkillFiles,
  MAX_SKILL_FILE_BYTES,
} from '../resolve-agent-identity';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    iconName: 'Bot',
    description: 'test',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    skillFileNames: [],
    skills: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(agent: AgentDefinition | null): AgentDefinitionRepository {
  return {
    getById: vi.fn().mockResolvedValue(agent),
    create: vi.fn(),
    upsert: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe('resolveAgentIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test-bucket';
    mockGetMetadata.mockResolvedValue([{ size: 100 }]);
  });

  it('returns undefined when agent not found', async () => {
    const repo = makeRepo(null);
    const result = await resolveAgentIdentity('missing', repo);
    expect(result.prompt).toBeUndefined();
    expect(result.warnings).toHaveLength(0);
  });

  it('returns undefined when agent has no systemPrompt and no skills', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '', skillFileNames: [] }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).toBeUndefined();
  });

  it('returns systemPrompt only when no skills', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You are a CDISC expert.', skillFileNames: [] }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).toContain('## Agent Identity');
    expect(result.prompt).toContain('You are a CDISC expert.');
    expect(result.prompt).not.toContain('## Skills');
  });

  it('returns skills only when no systemPrompt', async () => {
    mockDownload.mockResolvedValue([Buffer.from('Skill content here')]);
    const repo = makeRepo(makeAgent({ systemPrompt: '', skillFileNames: ['skills/a.md'] }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).not.toContain('## Agent Identity');
    expect(result.prompt).toContain('## Skills');
    expect(result.prompt).toContain('Skill content here');
  });

  it('returns both systemPrompt and skills', async () => {
    mockDownload.mockResolvedValue([Buffer.from('SDTM rules knowledge')]);
    const repo = makeRepo(makeAgent({
      systemPrompt: 'You author CDISC rules.',
      skillFileNames: ['skills/rules.md'],
      skills: [],
    }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).toContain('## Agent Identity');
    expect(result.prompt).toContain('You author CDISC rules.');
    expect(result.prompt).toContain('## Skills');
    expect(result.prompt).toContain('SDTM rules knowledge');
  });

  it('returns warning when download fails (partial success)', async () => {
    mockDownload
      .mockResolvedValueOnce([Buffer.from('Good skill')])
      .mockRejectedValueOnce(new Error('404 Not Found'));
    mockGetMetadata
      .mockResolvedValueOnce([{ size: 50 }])
      .mockResolvedValueOnce([{ size: 50 }]);
    const repo = makeRepo(makeAgent({
      skillFileNames: ['skills/good.md', 'skills/missing.md'],
      skills: [],
    }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).toContain('Good skill');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].path).toBe('skills/missing.md');
    expect(result.warnings[0].reason).toContain('404 Not Found');
  });

  it('resolveAgentIdentityPrompt returns just the prompt string', async () => {
    mockDownload.mockResolvedValue([Buffer.from('skill')]);
    const repo = makeRepo(makeAgent({ systemPrompt: 'Hello', skillFileNames: ['s.md'] }));
    const prompt = await resolveAgentIdentityPrompt('agent-1', repo);
    expect(prompt).toContain('Hello');
    expect(prompt).toContain('skill');
  });
});

describe('downloadSkillFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test-bucket';
    mockGetMetadata.mockResolvedValue([{ size: 100 }]);
  });

  it('returns warnings for all files when bucket env not set', async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const result = await downloadSkillFiles(['a.md', 'b.md']);
    expect(result.contents).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0].reason).toContain('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
  });

  it('downloads files in parallel', async () => {
    let concurrency = 0;
    let maxConcurrency = 0;
    mockDownload.mockImplementation(async () => {
      concurrency++;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      await new Promise((r) => setTimeout(r, 10));
      concurrency--;
      return [Buffer.from('content')];
    });
    const result = await downloadSkillFiles(['a.md', 'b.md', 'c.md']);
    expect(result.contents).toHaveLength(3);
    expect(maxConcurrency).toBeGreaterThan(1);
  });

  it('rejects files exceeding size limit', async () => {
    mockGetMetadata.mockResolvedValue([{ size: MAX_SKILL_FILE_BYTES + 1 }]);
    const result = await downloadSkillFiles(['big.md']);
    expect(result.contents).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toContain('exceeds');
    expect(result.warnings[0].reason).toContain('100KB');
  });

  it('skips empty files', async () => {
    mockDownload.mockResolvedValue([Buffer.from('   ')]);
    const result = await downloadSkillFiles(['empty.md']);
    expect(result.contents).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
