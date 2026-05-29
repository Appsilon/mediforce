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

  it('throws ForbiddenError for a member-role caller (bug fix)', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      listToolCatalogEntries({ namespace: 'alpha' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
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
