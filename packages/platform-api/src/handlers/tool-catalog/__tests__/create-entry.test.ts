import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryToolCatalogRepository,
} from '@mediforce/platform-core/testing';
import { createToolCatalogEntry } from '../create-entry';
import { ForbiddenError, HandlerError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, ownerRoles, sampleEntry, sampleHttpEntry } from './fixtures';

describe('createToolCatalogEntry handler', () => {
  let repo: InMemoryToolCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryToolCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('creates an entry for an admin caller and writes audit', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await createToolCatalogEntry(
      { namespace: 'alpha', ...sampleEntry },
      scope,
    );

    expect(result.entry.id).toBe('tealflow-mcp');
    expect(await repo.getById('alpha', 'tealflow-mcp')).not.toBeNull();

    const events = await auditRepo.getByEntity('toolCatalogEntry', 'tealflow-mcp');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('tool_catalog_entry.created');
    expect(events[0].actorId).toBe('u-admin');
  });

  it('creates an entry for an owner caller', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-owner', ['alpha'], ownerRoles),
    });

    const result = await createToolCatalogEntry(
      { namespace: 'alpha', ...sampleEntry },
      scope,
    );

    expect(result.entry.id).toBe('tealflow-mcp');
  });

  it('creates an entry for an api-key caller', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo, auditRepo });

    const result = await createToolCatalogEntry(
      { namespace: 'alpha', ...sampleEntry },
      scope,
    );

    expect(result.entry.id).toBe('tealflow-mcp');
    const events = await auditRepo.getByEntity('toolCatalogEntry', 'tealflow-mcp');
    expect(events[0].actorType).toBe('system');
  });

  it('derives id from command via slugifyCommand when id absent', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo, auditRepo });

    const result = await createToolCatalogEntry(
      { namespace: 'alpha', type: 'stdio', command: '/usr/local/bin/MyTool', args: [] },
      scope,
    );

    expect(result.entry.id).toBe('mytool');
  });

  it('throws validation HandlerError when id absent and command empty', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo, auditRepo });

    await expect(
      createToolCatalogEntry({ namespace: 'alpha', type: 'stdio', command: '/' }, scope),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('creates an entry for a member-role caller', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await createToolCatalogEntry({ namespace: 'alpha', ...sampleEntry }, scope);

    expect(await repo.getById('alpha', 'tealflow-mcp')).toEqual(sampleEntry);
  });

  it('throws ForbiddenError for a caller outside the namespace', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-other', ['beta']),
    });

    await expect(
      createToolCatalogEntry({ namespace: 'alpha', ...sampleEntry }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await repo.getById('alpha', 'tealflow-mcp')).toBeNull();
  });

  it('creates an http entry and derives its id from the url host', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo, auditRepo });
    const { id: _id, ...withoutId } = sampleHttpEntry;

    const result = await createToolCatalogEntry({ namespace: 'alpha', ...withoutId }, scope);

    expect(result.entry).toEqual({ ...sampleHttpEntry, id: 'api-githubcopilot-com' });
    const events = await auditRepo.getByEntity('toolCatalogEntry', 'api-githubcopilot-com');
    expect(events[0].inputSnapshot).toMatchObject({ type: 'http', url: sampleHttpEntry.url });
  });

  it('throws conflict HandlerError when the id is already taken', async () => {
    await repo.upsert('alpha', sampleEntry);
    const scope = createTestScope({
      toolCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const promise = createToolCatalogEntry(
      { namespace: 'alpha', ...sampleEntry },
      scope,
    );

    await expect(promise).rejects.toBeInstanceOf(HandlerError);
    await expect(promise).rejects.toMatchObject({ code: 'conflict' });
  });
});
