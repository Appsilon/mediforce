import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryToolCatalogRepository,
} from '@mediforce/platform-core/testing';
import { updateToolCatalogEntry } from '../update-entry.js';
import { ForbiddenError, NotFoundError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { adminRoles, memberRoles, sampleEntry } from './fixtures.js';

describe('updateToolCatalogEntry handler', () => {
  let repo: InMemoryToolCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    repo = new InMemoryToolCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    await repo.upsert('alpha', sampleEntry);
  });

  it('updates fields for an admin caller and writes audit', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await updateToolCatalogEntry(
      { namespace: 'alpha', id: 'tealflow-mcp', description: 'updated' },
      scope,
    );

    expect(result.entry.description).toBe('updated');
    expect(result.entry.command).toBe('npx'); // unchanged

    const events = await auditRepo.getByEntity('toolCatalogEntry', 'tealflow-mcp');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('tool_catalog_entry.updated');
  });

  it('throws NotFoundError when entry does not exist', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    await expect(
      updateToolCatalogEntry(
        { namespace: 'alpha', id: 'missing', description: 'x' },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError for a member-role caller (bug fix)', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      updateToolCatalogEntry(
        { namespace: 'alpha', id: 'tealflow-mcp', description: 'x' },
        scope,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
