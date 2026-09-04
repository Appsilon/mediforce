import { describe, it, expect } from 'vitest';
import type { DockerImageInfo, ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import type { ImageCapabilities } from '@mediforce/platform-core';
import {
  buildCatalogImageGroups,
  buildDaemonImageGroups,
  buildImagePicker,
  requiredRuntimeFor,
} from '../image-picker-options';
import type { WorkflowStep } from '@mediforce/platform-core';

function entry(
  overrides: Partial<ImageCatalogEntryView> & Pick<ImageCatalogEntryView, 'id' | 'name'>,
): ImageCatalogEntryView {
  return {
    intent: `what ${overrides.name} is for`,
    source: { kind: 'referenced', reference: overrides.name },
    capabilities: {},
    versions: [],
    availability: 'present',
    baseEntryId: null,
    ...overrides,
  };
}

function version(
  imageTag: string,
  capabilities: ImageCapabilities,
): ImageCatalogEntryView['versions'][number] {
  return {
    imageTag,
    imageId: `id-${imageTag}`,
    created: '1 day ago',
    size: '1GB',
    capabilities,
    lineage: { base: null, ownLabels: {} },
  };
}

const agentCapable: ImageCapabilities = { status: 'known', agentCapable: true, runtimes: ['claude', 'bash'] };
const notAgentCapable: ImageCapabilities = { status: 'known', agentCapable: false, runtimes: ['bash'] };
const unprobed: ImageCapabilities = { status: 'unknown' };

describe('image picker options — issue #1298', () => {
  describe('what an agent step is offered', () => {
    const catalog = [
      entry({
        id: 'golden',
        name: 'Golden image',
        intent: 'the agent image the platform ships',
        versions: [version('mediforce-golden-image:latest', agentCapable)],
      }),
      entry({
        id: 'alpine',
        name: 'Alpine',
        intent: 'a minimal base for scripts',
        versions: [version('alpine:3.24', notAgentCapable)],
      }),
    ];

    it('[UNIT] shows name and intent, never a bare repo:tag', () => {
      const [group] = buildCatalogImageGroups(catalog, 'agent');
      expect(group.options[0].label).toBe('Golden image — the agent image the platform ships');
      expect(group.options[0].value).toBe('mediforce-golden-image:latest');
    });

    it('[UNIT] drops an image a probe proved carries no agent CLI', () => {
      const labels = buildCatalogImageGroups(catalog, 'agent').flatMap((g) => g.options.map((o) => o.value));
      expect(labels).toEqual(['mediforce-golden-image:latest']);
    });

    it('[UNIT] still offers an unprobed image, marked as unvouched', () => {
      const groups = buildCatalogImageGroups(
        [entry({ id: 'x', name: 'Mystery', intent: 'nobody probed it', versions: [version('mystery:1', unprobed)] })],
        'agent',
      );
      expect(groups[0].options[0].label).toBe('Mystery — nobody probed it · not probed');
      expect(groups[0].options[0].value).toBe('mystery:1');
    });

    it('[UNIT] ranks nothing by name — the removed DEFAULT_AGENT_IMAGE star', () => {
      const labels = buildCatalogImageGroups(catalog, 'agent').flatMap((g) => g.options.map((o) => o.label));
      expect(labels.some((label) => label.startsWith('★'))).toBe(false);
    });
  });

  describe('what a script step is offered', () => {
    const catalog = [
      entry({ id: 'r', name: 'R image', intent: 'stats', versions: [version('r-base:4.4', { status: 'known', agentCapable: false, runtimes: ['Rscript', 'bash'] })] }),
      entry({ id: 'py', name: 'Python image', intent: 'pipelines', versions: [version('python:3.11', { status: 'known', agentCapable: false, runtimes: ['python3', 'bash'] })] }),
    ];

    it('[UNIT] filters by the runtime an inline script needs', () => {
      const values = buildCatalogImageGroups(catalog, 'script', 'Rscript').flatMap((g) => g.options.map((o) => o.value));
      expect(values).toEqual(['r-base:4.4']);
    });

    it('[UNIT] offers both when the runtime is not knowable', () => {
      const values = buildCatalogImageGroups(catalog, 'script').flatMap((g) => g.options.map((o) => o.value));
      expect(values).toEqual(['r-base:4.4', 'python:3.11']);
    });

    it('[UNIT] keeps an image the probe could not answer for', () => {
      const values = buildCatalogImageGroups(
        [entry({ id: 'x', name: 'Mystery', versions: [version('mystery:1', unprobed)] })],
        'script',
        'Rscript',
      ).flatMap((g) => g.options.map((o) => o.value));
      expect(values).toEqual(['mystery:1']);
    });

    it('[UNIT] does not apply the agent-capable rule to a script step', () => {
      const values = buildCatalogImageGroups(
        [entry({ id: 'a', name: 'Alpine', versions: [version('alpine:3.24', notAgentCapable)] })],
        'script',
      ).flatMap((g) => g.options.map((o) => o.value));
      expect(values).toEqual(['alpine:3.24']);
    });

    it('[UNIT] maps every script runtime onto the binary the probe looks for', () => {
      const step = (runtime: NonNullable<WorkflowStep['script']>['runtime']): WorkflowStep =>
        ({ id: 's', name: 'S', type: 'creation', executor: 'script', script: { runtime, inlineScript: 'x' } }) as WorkflowStep;
      expect(requiredRuntimeFor(step('javascript'))).toBe('node');
      expect(requiredRuntimeFor(step('python'))).toBe('python3');
      expect(requiredRuntimeFor(step('r'))).toBe('Rscript');
      expect(requiredRuntimeFor(step('bash'))).toBe('bash');
      expect(requiredRuntimeFor({ id: 's', name: 'S', type: 'creation', executor: 'script', script: { command: 'run' } } as WorkflowStep)).toBeUndefined();
    });
  });

  describe('grouping by base', () => {
    const catalog = [
      entry({ id: 'golden', name: 'Golden image', versions: [version('mediforce-golden-image:latest', agentCapable)] }),
      entry({ id: 'tealflow', name: 'TealFlow agent', baseEntryId: 'golden', versions: [version('tealflow:abc', agentCapable)] }),
      entry({ id: 'safety', name: 'Safety agent', baseEntryId: 'golden', versions: [version('safety:def', agentCapable)] }),
    ];

    it('[UNIT] sits derivatives of one base together, under its name', () => {
      const groups = buildCatalogImageGroups(catalog, 'agent');
      expect(groups.map((g) => g.label)).toEqual(['Base images', 'Built on Golden image']);
      expect(groups[1].options.map((o) => o.value)).toEqual(['tealflow:abc', 'safety:def']);
    });

    it('[UNIT] names a base that is not itself offered rather than dropping the group', () => {
      // The base carries no agent CLI, so it is not an option — its derivatives,
      // which added one, still are, and must still say what they were built on.
      const groups = buildCatalogImageGroups(
        [
          entry({ id: 'golden', name: 'Golden image', versions: [version('mediforce-golden-image:latest', notAgentCapable)] }),
          entry({ id: 'tealflow', name: 'TealFlow agent', baseEntryId: 'golden', versions: [version('tealflow:abc', agentCapable)] }),
        ],
        'agent',
      );
      expect(groups.map((g) => g.label)).toEqual(['Built on Golden image']);
    });

    it('[UNIT] labels a base outside the given list without inventing a name', () => {
      const groups = buildCatalogImageGroups(
        [entry({ id: 'tealflow', name: 'TealFlow agent', baseEntryId: 'gone', versions: [version('tealflow:abc', agentCapable)] })],
        'agent',
      );
      expect(groups[0].label).toBe('Built on an image outside this catalog');
    });
  });

  describe('versions', () => {
    it('[UNIT] distinguishes an entry with several versions by tag', () => {
      const groups = buildCatalogImageGroups(
        [entry({
          id: 'tealflow',
          name: 'TealFlow agent',
          intent: 'reads TealFlow specs',
          versions: [version('tealflow:abc', agentCapable), version('tealflow:def', agentCapable)],
        })],
        'agent',
      );
      expect(groups[0].options.map((o) => o.label)).toEqual([
        'TealFlow agent (abc) — reads TealFlow specs',
        'TealFlow agent (def) — reads TealFlow specs',
      ]);
    });

    it('[UNIT] offers nothing for an entry the daemon holds no image for', () => {
      expect(buildCatalogImageGroups(
        [entry({ id: 'gone', name: 'Gone', availability: 'absent', versions: [] })],
        'agent',
      )).toEqual([]);
    });
  });

  describe('degrading when the catalog cannot answer', () => {
    const dockerImages: DockerImageInfo[] = [
      { repository: 'alpine', tag: '3.24', id: 'a1', size: '8MB', created: '1d ago' },
      { repository: 'mediforce-golden-image', tag: 'latest', id: 'g1', size: '1GB', created: '1d ago' },
    ];

    it('[UNIT] falls back to the daemon listing when the catalog is empty', () => {
      const picker = buildImagePicker({ catalogEntries: [], dockerImages, executor: 'agent' });
      expect(picker.hasSource).toBe(true);
      expect(picker.groups).toEqual([{
        key: 'daemon',
        label: null,
        options: [
          { value: 'alpine:3.24', label: 'alpine:3.24' },
          { value: 'mediforce-golden-image:latest', label: 'mediforce-golden-image:latest' },
        ],
      }]);
    });

    it('[UNIT] falls back when every entry is version-less — an unreachable daemon', () => {
      const picker = buildImagePicker({
        catalogEntries: [entry({ id: 'golden', name: 'Golden image', availability: 'unknown', versions: [] })],
        dockerImages,
        executor: 'agent',
      });
      expect(picker.groups[0].label).toBeNull();
    });

    it('[UNIT] does NOT fall back when the catalog covers images but none suits the step', () => {
      // "None of these" is an answer. Re-offering the raw daemon list here would
      // put `alpine` back one click away from an agent step, which is the whole
      // failure #1298 removes.
      const picker = buildImagePicker({
        catalogEntries: [entry({
          id: 'alpine',
          name: 'Alpine',
          versions: [version('alpine:3.24', notAgentCapable)],
        })],
        dockerImages,
        executor: 'agent',
      });
      expect(picker.groups).toEqual([]);
      // The select still renders — its blank option is what registration fills in.
      expect(picker.hasSource).toBe(true);
    });

    it('[UNIT] offers nothing at all when neither the catalog nor the daemon has anything', () => {
      const picker = buildImagePicker({ catalogEntries: [], dockerImages: [], executor: 'agent' });
      expect(picker.groups).toEqual([]);
      expect(picker.hasSource).toBe(false);
    });

    it('[UNIT] drops an untagged daemon layer to its repository, as the picker always has', () => {
      expect(buildDaemonImageGroups([{ repository: 'scratch', tag: '<none>', id: 's1', size: '0B', created: '1d ago' }])[0].options)
        .toEqual([{ value: 'scratch', label: 'scratch' }]);
    });
  });
});
