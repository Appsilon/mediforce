import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryToolCatalogRepository,
} from '@mediforce/platform-core/testing';
import { updateToolCatalogEntry } from '../update-entry';
import { ForbiddenError, NotFoundError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, sampleEntry, sampleHttpEntry } from './fixtures';

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
    expect(result.entry).toMatchObject({ command: 'npx' }); // unchanged

    const events = await auditRepo.getByEntity('toolCatalogEntry', 'tealflow-mcp');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('tool_catalog_entry.updated');
  });

  it('clears an optional field sent as null and keeps the ones left out', async () => {
    await repo.upsert('alpha', { ...sampleEntry, env: { TOKEN: 'x' } });
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await updateToolCatalogEntry(
      { namespace: 'alpha', id: 'tealflow-mcp', args: null, env: null },
      scope,
    );

    expect(result.entry).not.toHaveProperty('args');
    expect(result.entry).not.toHaveProperty('env');
    expect(result.entry.description).toBe('TealFlow deployment MCP');
    expect(await repo.getById('alpha', 'tealflow-mcp')).toEqual(result.entry);
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

  it('updates an entry for a member-role caller', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    const result = await updateToolCatalogEntry(
      { namespace: 'alpha', id: 'tealflow-mcp', description: 'x' },
      scope,
    );

    expect(result.entry.description).toBe('x');
  });

  it('throws ForbiddenError for a caller outside the namespace', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-other', ['beta']),
    });

    await expect(
      updateToolCatalogEntry(
        { namespace: 'alpha', id: 'tealflow-mcp', description: 'x' },
        scope,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('updates the url and clears the auth of an http entry', async () => {
    await repo.upsert('alpha', sampleHttpEntry);
    const scope = createTestScope({ toolCatalogRepo: repo, auditRepo });

    const result = await updateToolCatalogEntry(
      { namespace: 'alpha', id: 'github', url: 'https://example.com/mcp', auth: null },
      scope,
    );

    expect(result.entry).toEqual({ id: 'github', type: 'http', url: 'https://example.com/mcp' });
  });

  it('rejects an http field on a stdio entry as a validation error', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo, auditRepo });

    await expect(
      updateToolCatalogEntry(
        { namespace: 'alpha', id: 'tealflow-mcp', url: 'https://example.com/mcp' },
        scope,
      ),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(await repo.getById('alpha', 'tealflow-mcp')).toEqual(sampleEntry);
  });
});
