import { describe, it, expect } from 'vitest';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { backfillInstanceNamespaces } from '../migrations/backfill-instance-namespaces';

type Doc = { id: string; data: Record<string, unknown> };

class MockDocSnap {
  constructor(private readonly doc: Doc) {}
  data() { return this.doc.data; }
  get id() { return this.doc.id; }
}

class MockQuery {
  constructor(private readonly docs: Doc[]) {}
  where(field: string, _op: string, value: unknown) {
    return new MockQuery(this.docs.filter((doc) => doc.data[field] === value));
  }
  async get() { return { docs: this.docs.map((d) => new MockDocSnap(d)) }; }
}

class MockCollection {
  constructor(private readonly docs: Doc[]) {}
  where(field: string, op: string, value: unknown) { return new MockQuery(this.docs).where(field, op, value); }
  doc(id: string) { return { update: async (patch: Record<string, unknown>) => { Object.assign(this.docs.find((d) => d.id === id)!.data, patch); } }; }
}

class MockDb {
  constructor(private readonly collections: Record<string, Doc[]>) {}
  collection(name: string) { return new MockCollection(this.collections[name] ?? []); }
}

describe('backfillInstanceNamespaces', () => {
  it('uses instance definitionVersion to resolve namespace when names overlap', async () => {
    const processInstances: Doc[] = [
      { id: 'inst-1', data: { deleted: false, definitionName: 'shared', definitionVersion: '1', namespace: null } },
    ];
    const workflowDefinitions: Doc[] = [
      { id: 'wf-a-v1', data: buildWorkflowDefinition({ id: 'wf-a-v1', name: 'shared', namespace: 'tenant-a', version: 1 }) },
      { id: 'wf-b-v2', data: buildWorkflowDefinition({ id: 'wf-b-v2', name: 'shared', namespace: 'tenant-b', version: 2 }) },
    ];

    const db = new MockDb({ processInstances, workflowDefinitions });

    await backfillInstanceNamespaces(db as never, {} as never);

    expect(processInstances[0].data.namespace).toBe('tenant-a');
  });
});
