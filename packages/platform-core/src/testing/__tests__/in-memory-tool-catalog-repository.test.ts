import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolCatalogRepository } from '../in-memory-tool-catalog-repository';
import type { StdioToolCatalogEntry } from '../../schemas/agent-mcp-binding';

function makeEntry(overrides: Partial<StdioToolCatalogEntry> = {}): StdioToolCatalogEntry {
  return {
    id: 'tealflow-mcp',
    type: 'stdio',
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
    if (retrieved?.type === 'stdio') retrieved.command = 'hacked';
    const retrievedAgain = await repo.getById('appsilon', 'tealflow-mcp');
    expect(retrievedAgain).toMatchObject({ command: 'tealflow-mcp' });
  });

  it('upsert replaces existing entry with same id', async () => {
    await repo.upsert('appsilon', makeEntry({ command: 'v1' }));
    await repo.upsert('appsilon', makeEntry({ command: 'v2' }));

    const retrieved = await repo.getById('appsilon', 'tealflow-mcp');
    expect(retrieved).toMatchObject({ command: 'v2' });
  });

  it('isolates entries by namespace', async () => {
    await repo.upsert('appsilon', makeEntry({ id: 'shared-id', command: 'cmd-a' }));
    await repo.upsert('other-org', makeEntry({ id: 'shared-id', command: 'cmd-b' }));

    const appsilon = await repo.getById('appsilon', 'shared-id');
    const otherOrg = await repo.getById('other-org', 'shared-id');
    expect(appsilon).toMatchObject({ command: 'cmd-a' });
    expect(otherOrg).toMatchObject({ command: 'cmd-b' });
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
