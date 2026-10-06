import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolCatalogRepository } from '@mediforce/platform-core/testing';
import { listToolCatalogEntries } from '../list-entries';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, sampleEntry } from './fixtures';

describe('listToolCatalogEntries handler', () => {
  let repo: InMemoryToolCatalogRepository;

  beforeEach(async () => {
    repo = new InMemoryToolCatalogRepository();
    await repo.upsert('alpha', sampleEntry);
  });

  it('returns entries for an api-key caller', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    const result = await listToolCatalogEntries({ namespace: 'alpha' }, scope);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe('tealflow-mcp');
  });

  it('returns entries for an admin user caller', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await listToolCatalogEntries({ namespace: 'alpha' }, scope);

    expect(result.entries).toHaveLength(1);
  });

  it('gives a member-role caller the command but not the args or env', async () => {
    await repo.upsert('alpha', { ...sampleEntry, env: { TOKEN: 'secret' } });
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    const result = await listToolCatalogEntries({ namespace: 'alpha' }, scope);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].command).toBe(sampleEntry.command);
    expect(result.entries[0]).not.toHaveProperty('args');
    expect(result.entries[0]).not.toHaveProperty('env');
  });

  it('throws ForbiddenError for a non-member caller', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-other', ['beta']),
    });

    await expect(
      listToolCatalogEntries({ namespace: 'alpha' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
