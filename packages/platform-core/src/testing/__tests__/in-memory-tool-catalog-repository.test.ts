import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolCatalogRepository } from '../in-memory-tool-catalog-repository.js';
import type { ToolCatalogEntry } from '../../schemas/agent-mcp-binding.js';

function makeEntry(overrides: Partial<ToolCatalogEntry> = {}): ToolCatalogEntry {
  return {
    id: 'tealflow-mcp',
    command: 'tealflow-mcp',
    args: [],
    description: 'Tealflow MCP — lists and describes teal modules',
    ...overrides,
  };
}

describe('InMemoryToolCatalogRepository', () => {
  let repo: InMemoryToolCatalogRepository;

  beforeEach(() => {
    repo = new InMemoryToolCatalogRepository();
  });

  it('returns null for missing entry', async () => {
    const result = await repo.getById('appsilon', 'missing');
    expect(result).toBeNull();
  });

  it('upsert then getById returns a clone of the stored entry', async () => {
    const entry = makeEntry();
    await repo.upsert('appsilon', entry);

    const retrieved = await repo.getById('appsilon', 'tealflow-mcp');
    expect(retrieved).toEqual(entry);
    // Mutating the retrieved copy must not affect storage
    retrieved!.command = 'hacked';
    const retrievedAgain = await repo.getById('appsilon', 'tealflow-mcp');
    expect(retrievedAgain!.command).toBe('tealflow-mcp');
  });

  it('upsert replaces existing entry with same id', async () => {
    await repo.upsert('appsilon', makeEntry({ command: 'v1' }));
    await repo.upsert('appsilon', makeEntry({ command: 'v2' }));

    const retrieved = await repo.getById('appsilon', 'tealflow-mcp');
    expect(retrieved!.command).toBe('v2');
  });

  it('isolates entries by namespace', async () => {
    await repo.upsert('appsilon', makeEntry({ id: 'shared-id', command: 'cmd-a' }));
    await repo.upsert('other-org', makeEntry({ id: 'shared-id', command: 'cmd-b' }));

    const appsilon = await repo.getById('appsilon', 'shared-id');
    const otherOrg = await repo.getById('other-org', 'shared-id');
    expect(appsilon!.command).toBe('cmd-a');
    expect(otherOrg!.command).toBe('cmd-b');
  });

  it('list returns only entries in the given namespace', async () => {
    await repo.upsert('appsilon', makeEntry({ id: 'a' }));
    await repo.upsert('appsilon', makeEntry({ id: 'b' }));
    await repo.upsert('other-org', makeEntry({ id: 'c' }));

    const appsilonList = await repo.list('appsilon');
    expect(appsilonList.map((e) => e.id).sort()).toEqual(['a', 'b']);
    const otherOrgList = await repo.list('other-org');
    expect(otherOrgList.map((e) => e.id)).toEqual(['c']);
  });

  it('delete removes only the target entry', async () => {
    await repo.upsert('appsilon', makeEntry({ id: 'a' }));
    await repo.upsert('appsilon', makeEntry({ id: 'b' }));
    await repo.delete('appsilon', 'a');

    expect(await repo.getById('appsilon', 'a')).toBeNull();
    expect(await repo.getById('appsilon', 'b')).not.toBeNull();
  });

  it('delete is a no-op for absent entries', async () => {
    await expect(repo.delete('appsilon', 'never-existed')).resolves.toBeUndefined();
  });
});
