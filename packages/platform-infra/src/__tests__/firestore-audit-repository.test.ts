import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { ProcessInstanceRepository } from '@mediforce/platform-core';
import { FirestoreAuditRepository } from '../firestore/audit-repository.js';

/**
 * Real Firestore rejects `undefined` values with
 *   "Cannot use undefined as a Firestore value"
 * unless the SDK is initialised with `ignoreUndefinedProperties: true`.
 * The in-memory test double accepts undefined silently, so handler unit
 * tests cannot catch this — only an integration against real Firestore
 * (or an explicit unit test like this one) does.
 *
 * Bug it covers: `inputSnapshot` payloads in handlers like
 * `createToolCatalogEntry` carry optional fields (`args?`) that are
 * `undefined` when omitted; append() must scrub those before the write.
 */

interface AddCall {
  data: Record<string, unknown>;
}

function makeRejectUndefinedDb(adds: AddCall[]): Firestore {
  function assertNoUndefined(value: unknown, path: string): void {
    if (value === undefined) {
      throw new Error(`Cannot use undefined as a Firestore value (found in field "${path}")`);
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      assertNoUndefined(v, path === '' ? k : `${path}.${k}`);
    }
  }

  return {
    collection: (_name: string) => ({
      add: vi.fn(async (data: Record<string, unknown>) => {
        assertNoUndefined(data, '');
        adds.push({ data });
        return {
          get: async () => ({
            data: () => ({ ...data, serverTimestamp: { toDate: () => new Date('2026-01-01T00:00:00Z') } }),
          }),
        };
      }),
    }),
  } as unknown as Firestore;
}

const parents = {} as unknown as ProcessInstanceRepository;

describe('FirestoreAuditRepository.append — undefined scrubbing', () => {
  let adds: AddCall[];
  let repo: FirestoreAuditRepository;

  beforeEach(() => {
    adds = [];
    repo = new FirestoreAuditRepository(makeRejectUndefinedDb(adds), parents);
  });

  it('accepts events whose inputSnapshot contains undefined nested fields', async () => {
    // Mirrors `createToolCatalogEntry`: `args` is optional on the catalog
    // entry, so the audit payload occasionally carries `args: undefined`.
    await expect(
      repo.append({
        actorId: 'user-1',
        actorType: 'user',
        actorRole: 'admin',
        action: 'tool_catalog_entry.created',
        description: 'Tool catalog entry created',
        timestamp: '2026-01-01T00:00:00.000Z',
        inputSnapshot: {
          namespace: 'appsilon',
          id: 'echo',
          command: 'echo',
          args: undefined,
        },
        outputSnapshot: { id: 'echo' },
        basis: 'Tool catalog entry created via API',
        entityType: 'toolCatalogEntry',
        entityId: 'echo',
      }),
    ).resolves.toMatchObject({ entityId: 'echo' });

    expect(adds).toHaveLength(1);
    const writtenSnapshot = adds[0].data.inputSnapshot as Record<string, unknown>;
    expect(writtenSnapshot).not.toHaveProperty('args');
    expect(writtenSnapshot).toMatchObject({ namespace: 'appsilon', id: 'echo', command: 'echo' });
  });

  it('drops top-level optional fields when set to undefined', async () => {
    // `processInstanceId`, `stepId`, `processDefinitionVersion` are all
    // optional on AuditEvent. When omitted by a handler, they arrive as
    // `undefined` rather than missing keys.
    await repo.append({
      actorId: 'user-1',
      actorType: 'user',
      actorRole: 'admin',
      action: 'noop.done',
      description: 'noop',
      timestamp: '2026-01-01T00:00:00.000Z',
      inputSnapshot: { x: 1 },
      outputSnapshot: { ok: true },
      basis: 'test',
      entityType: 'case',
      entityId: 'case-1',
      processInstanceId: undefined,
      stepId: undefined,
      processDefinitionVersion: undefined,
    });

    expect(adds).toHaveLength(1);
    expect(adds[0].data).not.toHaveProperty('processInstanceId');
    expect(adds[0].data).not.toHaveProperty('stepId');
    expect(adds[0].data).not.toHaveProperty('processDefinitionVersion');
  });

  it('preserves null values (null ≠ undefined in Firestore semantics)', async () => {
    await repo.append({
      actorId: 'user-1',
      actorType: 'user',
      actorRole: 'admin',
      action: 'noop.done',
      description: 'noop',
      timestamp: '2026-01-01T00:00:00.000Z',
      inputSnapshot: { explicitlyNull: null, alsoSet: 'value' },
      outputSnapshot: { ok: true },
      basis: 'test',
      entityType: 'case',
      entityId: 'case-1',
    });

    const writtenSnapshot = adds[0].data.inputSnapshot as Record<string, unknown>;
    expect(writtenSnapshot.explicitlyNull).toBeNull();
    expect(writtenSnapshot.alsoSet).toBe('value');
  });

  it('preserves the FieldValue.serverTimestamp() sentinel unchanged', async () => {
    // Bug: a naive deep-strip-undefined that walks every object recursively
    // mistakes the Admin SDK FieldValue sentinel (a class instance) for a
    // plain object and rebuilds it as `{}` (or worse). Firestore then writes
    // a regular Map instead of resolving the server timestamp, and
    // `data.serverTimestamp.toDate()` blows up on the read-back. The fix
    // must skip non-plain-object instances (Date, FieldValue, Timestamp).
    await repo.append({
      actorId: 'user-1',
      actorType: 'user',
      actorRole: 'admin',
      action: 'noop.done',
      description: 'noop',
      timestamp: '2026-01-01T00:00:00.000Z',
      inputSnapshot: { args: undefined, x: 1 },
      outputSnapshot: { ok: true },
      basis: 'test',
      entityType: 'case',
      entityId: 'case-1',
    });

    // The serverTimestamp sentinel ends up on the written doc unchanged —
    // identity-preserved (not a deep-copy plain object).
    const written = adds[0].data.serverTimestamp;
    expect(written).toBeDefined();
    // Plain objects from `{}` literal have Object.prototype; the sentinel
    // is a class instance and does not. This is what Firestore relies on.
    expect(Object.getPrototypeOf(written)).not.toBe(Object.prototype);
  });
});
