import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryToolCatalogRepository,
} from '@mediforce/platform-core/testing';
import { deleteToolCatalogEntry } from '../delete-entry';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, sampleEntry } from './fixtures';

describe('deleteToolCatalogEntry handler', () => {
  let repo: InMemoryToolCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    repo = new InMemoryToolCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    await repo.upsert('alpha', sampleEntry);
  });

  it('deletes an entry for an admin caller and writes audit', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await deleteToolCatalogEntry(
      { namespace: 'alpha', id: 'tealflow-mcp' },
      scope,
    );

    expect(result.success).toBe(true);
    expect(await repo.getById('alpha', 'tealflow-mcp')).toBeNull();

    const events = await auditRepo.getByEntity('toolCatalogEntry', 'tealflow-mcp');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('tool_catalog_entry.deleted');
  });

  it('is idempotent: returns success and emits no audit for absent id', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await deleteToolCatalogEntry(
      { namespace: 'alpha', id: 'missing' },
      scope,
    );

    expect(result.success).toBe(true);
    const events = await auditRepo.getByEntity('toolCatalogEntry', 'missing');
    expect(events).toHaveLength(0);
  });

  it('throws ForbiddenError for a member-role caller (bug fix)', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      deleteToolCatalogEntry({ namespace: 'alpha', id: 'tealflow-mcp' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await repo.getById('alpha', 'tealflow-mcp')).not.toBeNull();
  });
});
