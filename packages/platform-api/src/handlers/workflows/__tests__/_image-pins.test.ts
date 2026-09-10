import { describe, it, expect } from 'vitest';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { WorkflowDefinitionGroup } from '@mediforce/platform-core';
import { deriveBuildTag } from '@mediforce/agent-runtime';
import { findWorkflowImagePins } from '../_image-pins';

/** One group, with the versions given and the liveness metadata a scan reads. */
function group(
  versions: { version: number; image?: string; archived?: boolean }[],
  options: { defaultVersion?: number | null; name?: string; namespace?: string } = {},
): WorkflowDefinitionGroup {
  const name = options.name ?? 'sdtm-qc';
  const namespace = options.namespace ?? 'acme';
  return {
    namespace,
    name,
    versions: versions.map((entry) =>
      buildWorkflowDefinition({
        name,
        namespace,
        version: entry.version,
        title: 'SDTM QC',
        ...(entry.archived === true ? { archived: true } : {}),
        steps: [
          {
            id: 'analyse',
            name: 'Analyse',
            type: 'creation',
            executor: 'agent',
            autonomyLevel: 'L2',
            ...(entry.image === undefined ? {} : { agent: { image: entry.image } }),
          },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'analyse', to: 'done' }],
      }),
    ),
    latestVersion: Math.max(...versions.map((entry) => entry.version)),
    defaultVersion: options.defaultVersion ?? null,
  };
}

describe('findWorkflowImagePins', () => {
  it('reports every version that pins the image, not only the latest', () => {
    const pins = findWorkflowImagePins(
      [group([
        { version: 3, image: 'tealflow:v3' },
        { version: 2, image: 'tealflow:v2' },
        { version: 1, image: 'tealflow:v2' },
      ])],
      ['tealflow:v2'],
    );

    // The old scan looked at `latestVersion` alone, so a caller asking "what
    // breaks if I delete this?" was told nothing about v2 and v1.
    expect(pins.map((pin) => pin.version).sort()).toEqual([1, 2]);
  });

  it('calls the latest version live when the workflow sets no default', () => {
    const pins = findWorkflowImagePins(
      [group([
        { version: 2, image: 'tealflow:v2' },
        { version: 1, image: 'tealflow:v2' },
      ])],
      ['tealflow:v2'],
    );

    expect(pins.find((pin) => pin.version === 2)?.live).toBe(true);
    // History: a registered version is immutable, so this one can never be
    // re-pointed at another image.
    expect(pins.find((pin) => pin.version === 1)?.live).toBe(false);
  });

  it('calls the default version live, not the latest, when one is pinned', () => {
    const pins = findWorkflowImagePins(
      [group(
        [
          { version: 3, image: 'tealflow:v2' },
          { version: 2, image: 'tealflow:v2' },
        ],
        { defaultVersion: 2 },
      )],
      ['tealflow:v2'],
    );

    // A run starts from the default version, so that is the one a deletion
    // breaks — the newest may be a draft nobody runs.
    expect(pins.find((pin) => pin.version === 2)?.live).toBe(true);
    expect(pins.find((pin) => pin.version === 3)?.live).toBe(false);
  });

  it('never calls an archived version live, even when it is the latest', () => {
    const pins = findWorkflowImagePins(
      [group([{ version: 2, image: 'tealflow:v2', archived: true }])],
      ['tealflow:v2'],
    );

    expect(pins).toHaveLength(1);
    expect(pins[0].archived).toBe(true);
    // Archived means not runnable, so nothing breaks by deleting what it pins.
    expect(pins[0].live).toBe(false);
  });

  it('matches a bare repository against its implicit latest tag', () => {
    const pins = findWorkflowImagePins(
      [group([{ version: 1, image: 'mediforce-golden-image' }])],
      ['mediforce-golden-image:latest'],
    );

    expect(pins).toHaveLength(1);
    // Echoed back as asked for, so the caller can match it to its own list.
    expect(pins[0].images).toEqual(['mediforce-golden-image:latest']);
  });

  it('reports only the requested images a version actually uses', () => {
    const pins = findWorkflowImagePins(
      [group([{ version: 1, image: 'tealflow:v2' }])],
      ['tealflow:v2', 'other:v1'],
    );

    expect(pins[0].images).toEqual(['tealflow:v2']);
    expect(pins[0].steps).toEqual(['analyse']);
  });

  it('ignores a workflow whose steps pin none of them', () => {
    expect(
      findWorkflowImagePins([group([{ version: 1, image: 'unrelated:v1' }])], ['tealflow:v2']),
    ).toEqual([]);
  });

  it('finds a build-mode step whose image is derived rather than written', () => {
    const built = buildWorkflowDefinition({
      name: 'build-mode',
      namespace: 'acme',
      version: 1,
      steps: [
        {
          id: 'build',
          name: 'Build',
          type: 'creation',
          executor: 'agent',
          autonomyLevel: 'L2',
          agent: {
            repo: 'git@github.com:Appsilon/tealflow.git',
            commit: 'abc1234',
            dockerfile: 'Dockerfile',
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'build', to: 'done' }],
    });
    // The step stores no image at all: the tag it runs under is what the
    // runtime derives from its build inputs, so matching on the stored string
    // would miss it.
    const derivedTag = deriveBuildTag(
      'git@github.com:Appsilon/tealflow.git',
      'abc1234',
      'Dockerfile',
    );

    const pins = findWorkflowImagePins(
      [
        {
          namespace: 'acme',
          name: 'build-mode',
          versions: [built],
          latestVersion: 1,
          defaultVersion: null,
        },
      ],
      [derivedTag],
    );

    expect(pins).toHaveLength(1);
    expect(pins[0].steps).toEqual(['build']);
    expect(pins[0].live).toBe(true);
  });
});
