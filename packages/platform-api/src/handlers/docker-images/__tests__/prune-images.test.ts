import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import type { AgentDefinition, WorkflowDefinitionGroup } from '@mediforce/platform-core';
import { resolveStepImage } from '@mediforce/agent-runtime';
import type { DockerImageInfo } from '../../../contract/system';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import { fetchDaemonImages } from '../../system/_docker';
import { IMAGE_PRUNE_AUDIT_ENTITY, planImagePrune, pruneDockerImages, type ImagePruneFacts } from '../prune-images';

vi.mock('../../system/_docker', () => ({ fetchDaemonImages: vi.fn() }));

const NOW = new Date('2026-11-27T12:00:00Z');
const OLD = '2026-10-01T00:00:00.000Z';
const RECENT = '2026-11-25T00:00:00.000Z';

const REPO = 'https://github.com/acme/tools.git';
/** The tag the runtime builds a repo step under — derived the way it derives it. */
function builtTag(commit: string): string {
  return resolveStepImage({ repo: REPO, commit, dockerfile: 'Dockerfile' }) ?? '';
}
const BUILT_V1 = builtTag('aaa111');
const BUILT_V2 = builtTag('bbb222');

/** A daemon row the runtime's builder made; `createdAt: null` is a row whose
 *  age the daemon did not report, `labelled: false` one without build labels. */
function image(reference: string, createdAt: string | null = OLD, labelled = true): DockerImageInfo {
  const [repository, tag] = reference.split(':');
  return {
    repository: repository ?? '',
    tag: tag ?? '',
    id: `sha256:${reference}`,
    size: '1GB',
    created: '2 months ago',
    ...(createdAt === null ? {} : { createdAt }),
    ...(labelled === true ? { buildCommit: 'aaa111' } : {}),
  };
}

type StepSource = { image: string } | { repo: string; commit: string; dockerfile: string };

/** One workflow; each entry is one version's single agent step. */
function workflow(versions: StepSource[], defaultVersion: number | null = null): WorkflowDefinitionGroup {
  return {
    namespace: 'acme',
    name: 'sdtm-qc',
    versions: versions.map((agent, index) =>
      buildWorkflowDefinition({
        name: 'sdtm-qc',
        namespace: 'acme',
        version: index + 1,
        steps: [
          { id: 'analyse', name: 'Analyse', type: 'creation', executor: 'agent', autonomyLevel: 'L2', agent },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'analyse', to: 'done' }],
      }),
    ),
    latestVersion: versions.length,
    defaultVersion,
  };
}

function plan(overrides: Partial<ImagePruneFacts>) {
  return planImagePrune({ images: [], groups: [], agents: [], runs: [], minAgeDays: 14, now: NOW, ...overrides });
}

function reasons(result: ReturnType<typeof plan>): Record<string, string> {
  return Object.fromEntries(result.kept.map((row) => [row.image, row.reason]));
}

describe('planImagePrune', () => {
  it('prunes an old image nothing names', () => {
    const result = plan({ images: [image('mediforce-artifacts:orphan')] });
    expect(result.pruned.map((row) => row.image)).toEqual(['mediforce-artifacts:orphan']);
    expect(result.kept).toEqual([]);
  });

  it('never considers images outside the rebuildable repositories, or untagged ones', () => {
    const result = plan({
      images: [
        image('mediforce-agent:latest'),
        image('mediforce-golden-image:latest'),
        image('acme/uploaded:v1'),
        image('mediforce-built:<none>'),
      ],
    });
    expect(result).toEqual({ pruned: [], kept: [] });
  });

  it('keeps an image the version runs start from names, even when it could be rebuilt', () => {
    const result = plan({
      images: [image(BUILT_V1)],
      groups: [workflow([{ repo: REPO, commit: 'aaa111', dockerfile: 'Dockerfile' }])],
    });
    expect(reasons(result)).toEqual({ [BUILT_V1]: 'workflow' });
  });

  it('prunes what only a superseded version names when that version can rebuild it', () => {
    const result = plan({
      images: [image(BUILT_V1), image(BUILT_V2)],
      groups: [
        workflow([
          { repo: REPO, commit: 'aaa111', dockerfile: 'Dockerfile' },
          { repo: REPO, commit: 'bbb222', dockerfile: 'Dockerfile' },
        ]),
      ],
    });
    expect(result.pruned.map((row) => row.image)).toEqual([BUILT_V1]);
    expect(reasons(result)).toEqual({ [BUILT_V2]: 'workflow' });
  });

  it('keeps what a superseded version names outright, with nothing to rebuild it from', () => {
    const result = plan({
      images: [image('mediforce-built:pinned'), image('mediforce-built:current')],
      groups: [workflow([{ image: 'mediforce-built:pinned' }, { image: 'mediforce-built:current' }])],
    });
    expect(reasons(result)).toEqual({
      'mediforce-built:pinned': 'workflow',
      'mediforce-built:current': 'workflow',
    });
  });

  it('keeps what a live run on a superseded version needs, rebuildable or not', () => {
    const result = plan({
      images: [image(BUILT_V1)],
      groups: [
        workflow([
          { repo: REPO, commit: 'aaa111', dockerfile: 'Dockerfile' },
          { repo: REPO, commit: 'bbb222', dockerfile: 'Dockerfile' },
        ]),
      ],
      runs: [
        buildProcessInstance({ namespace: 'acme', definitionName: 'sdtm-qc', definitionVersion: '1', status: 'paused' }),
      ],
    });
    expect(reasons(result)).toEqual({ [BUILT_V1]: 'run' });
  });

  it('keeps what an unfinished eval trial carries in its own definition', () => {
    const evalDefinition = buildWorkflowDefinition({
      name: 'sdtm-qc',
      namespace: 'acme',
      version: 1,
      steps: [
        { id: 'analyse', name: 'Analyse', type: 'creation', executor: 'agent', autonomyLevel: 'L2', agent: { image: 'mediforce-built:variant' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyse', to: 'done' }],
    });
    const result = plan({
      images: [image('mediforce-built:variant')],
      groups: [workflow([{ image: 'mediforce-built:current' }])],
      runs: [
        buildProcessInstance({ namespace: 'acme', definitionName: 'sdtm-qc', definitionVersion: '1', status: 'created', evalDefinition }),
      ],
    });
    expect(reasons(result)).toEqual({ 'mediforce-built:variant': 'run' });
  });

  it('keeps an image in a prunable repository that the runtime did not build', () => {
    const result = plan({ images: [image('mediforce-built:pulled', OLD, false)] });
    expect(reasons(result)).toEqual({ 'mediforce-built:pulled': 'provenance-unknown' });
  });

  it('keeps an image an agent names', () => {
    const agent = { image: 'mediforce-built:agent' } as AgentDefinition;
    const result = plan({ images: [image('mediforce-built:agent')], agents: [agent] });
    expect(reasons(result)).toEqual({ 'mediforce-built:agent': 'agent' });
  });

  it('keeps a recent image, and one whose age the daemon did not report', () => {
    const result = plan({
      images: [image('mediforce-artifacts:fresh', RECENT), image('mediforce-artifacts:undated', null)],
    });
    expect(reasons(result)).toEqual({
      'mediforce-artifacts:fresh': 'recent',
      'mediforce-artifacts:undated': 'age-unknown',
    });
  });

  it('narrows to the images asked for', () => {
    const result = plan({
      images: [image('mediforce-artifacts:a'), image('mediforce-artifacts:b')],
      only: ['mediforce-artifacts:b'],
    });
    expect(result.pruned.map((row) => row.image)).toEqual(['mediforce-artifacts:b']);
  });
});

describe('pruneDockerImages audit clock', () => {
  beforeEach(() => {
    vi.mocked(fetchDaemonImages).mockResolvedValue({ available: true, images: [image('mediforce-artifacts:orphan')] });
  });

  async function sweepAuditCount(input: { images?: string[] }): Promise<number> {
    const instanceRepo = new InMemoryProcessInstanceRepository();
    const auditRepo = new InMemoryAuditRepository(instanceRepo);
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      dockerImages: { delete: async (imageId) => ({ deleted: imageId }) },
    });
    await pruneDockerImages({ dryRun: false, minAgeDays: 14, ...input }, scope);
    const sweeps = await scope.system.audit.getByEntity(IMAGE_PRUNE_AUDIT_ENTITY.entityType, IMAGE_PRUNE_AUDIT_ENTITY.entityId);
    return sweeps.length;
  }

  it('a full sweep advances the daily clock', async () => {
    expect(await sweepAuditCount({})).toBe(1);
  });

  it('a sweep narrowed to some images leaves the daily clock alone', async () => {
    expect(await sweepAuditCount({ images: ['mediforce-artifacts:orphan'] })).toBe(0);
  });
});
