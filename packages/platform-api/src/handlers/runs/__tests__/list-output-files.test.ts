import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { OutputFileEntry } from '@mediforce/agent-runtime';
import { listRunOutputFiles } from '../list-output-files';
import { NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

interface ReaderCall {
  workflow: { name: string; namespace?: string };
  runId: string;
}

function stubReader(entries: OutputFileEntry[]) {
  const calls: ReaderCall[] = [];
  return {
    calls,
    listOutputFiles: async (workflow: { name: string; namespace?: string }, runId: string) => {
      calls.push({ workflow, runId });
      return entries;
    },
  };
}

describe('listRunOutputFiles handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  it('returns the Output Files for the run, addressing the workspace by run identity', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'r1',
        namespace: 'alpha',
        definitionName: 'wf',
        status: 'completed',
      }),
    );
    const entries: OutputFileEntry[] = [
      { stepId: 'extract', name: 'report.csv', path: '.mediforce/output/extract/report.csv', size: 12 },
      { stepId: 'render', name: 'charts/plot.svg', path: '.mediforce/output/render/charts/plot.svg', size: 7 },
    ];
    const reader = stubReader(entries);

    const scope = createTestScope({ instanceRepo });
    const result = await listRunOutputFiles({ runId: 'r1' }, scope, reader);

    expect(result).toEqual({ files: entries });
    expect(reader.calls).toEqual([
      { workflow: { name: 'wf', namespace: 'alpha' }, runId: 'r1' },
    ]);
  });

  it('returns an empty list when the run has no Output Files', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf' }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await listRunOutputFiles({ runId: 'r1' }, scope, stubReader([]));

    expect(result).toEqual({ files: [] });
  });

  it('throws NotFoundError for a truly missing runId without touching the reader', async () => {
    const reader = stubReader([]);
    const scope = createTestScope({ instanceRepo });

    await expect(listRunOutputFiles({ runId: 'missing' }, scope, reader)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(reader.calls).toEqual([]);
  });

  it('throws NotFoundError for a foreign-workspace runId (anti-enumeration) without touching the reader', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf' }),
    );
    const reader = stubReader([]);

    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-2', ['beta']),
    });

    await expect(listRunOutputFiles({ runId: 'r1' }, scope, reader)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(reader.calls).toEqual([]);
  });

  it('returns the files for a user caller in the namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf' }),
    );
    const entries: OutputFileEntry[] = [
      { stepId: 's1', name: 'out.txt', path: '.mediforce/output/s1/out.txt', size: 3 },
    ];

    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-1', ['alpha']),
    });
    const result = await listRunOutputFiles({ runId: 'r1' }, scope, stubReader(entries));

    expect(result.files).toEqual(entries);
  });
});
