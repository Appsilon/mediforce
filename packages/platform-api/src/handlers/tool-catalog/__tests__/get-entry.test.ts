import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolCatalogRepository } from '@mediforce/platform-core/testing';
import { getToolCatalogEntry } from '../get-entry.js';
import { ForbiddenError, NotFoundError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { adminRoles, memberRoles, sampleEntry } from './fixtures.js';

describe('getToolCatalogEntry handler', () => {
  let repo: InMemoryToolCatalogRepository;

  beforeEach(async () => {
    repo = new InMemoryToolCatalogRepository();
    await repo.upsert('alpha', sampleEntry);
  });

  it('returns the entry for an admin caller', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await getToolCatalogEntry(
      { namespace: 'alpha', id: 'tealflow-mcp' },
      scope,
    );

    expect(result.entry.id).toBe('tealflow-mcp');
  });

  it('returns the entry for an api-key caller', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    const result = await getToolCatalogEntry(
      { namespace: 'alpha', id: 'tealflow-mcp' },
      scope,
    );

    expect(result.entry.command).toBe('npx');
  });

  it('throws NotFoundError when entry does not exist', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    await expect(
      getToolCatalogEntry({ namespace: 'alpha', id: 'missing' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError for a member-role caller (bug fix)', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      getToolCatalogEntry({ namespace: 'alpha', id: 'tealflow-mcp' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
