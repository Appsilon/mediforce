import { describe, it, expect } from 'vitest';
import {
  imageStepDelta,
  isImageDescendantOf,
  ownImageLabels,
  parseImageHistory,
  readableBuildStepCommand,
  resolveImageBases,
} from '../image-lineage';

/** Layer arrays are content-addressed diff ids; the shape is all that matters. */
const layer = (name: string): string => `sha256:${name}`;

const BASE = [layer('a'), layer('b')];
const CHILD = [...BASE, layer('c')];
const GRANDCHILD = [...CHILD, layer('d')];
const UNRELATED = [layer('x'), layer('y'), layer('z')];

describe('isImageDescendantOf', () => {
  it('holds when the child array starts with the whole of the parent array', () => {
    expect(isImageDescendantOf(CHILD, BASE)).toBe(true);
    expect(isImageDescendantOf(GRANDCHILD, BASE)).toBe(true);
  });

  it('rejects an image that shares no prefix', () => {
    expect(isImageDescendantOf(UNRELATED, BASE)).toBe(false);
    // Same layers, different order: a prefix is ordered, not a set.
    expect(isImageDescendantOf([layer('b'), layer('a'), layer('c')], BASE)).toBe(false);
  });

  it('rejects identical layer arrays, which cannot be ordered from layers alone', () => {
    expect(isImageDescendantOf(BASE, BASE)).toBe(false);
    expect(isImageDescendantOf(BASE, CHILD)).toBe(false);
  });

  it('refuses a layerless parent rather than making it everyone ancestor', () => {
    expect(isImageDescendantOf(CHILD, [])).toBe(false);
    expect(isImageDescendantOf([], [])).toBe(false);
  });
});

describe('resolveImageBases', () => {
  it('resolves a chain three deep to its nearest base, not to the root', () => {
    const bases = resolveImageBases([
      { id: 'root', layers: BASE },
      { id: 'child', layers: CHILD },
      { id: 'grandchild', layers: GRANDCHILD },
    ]);

    expect(bases.get('grandchild')).toBe('child');
    expect(bases.get('child')).toBe('root');
    expect(bases.has('root')).toBe(false);
  });

  it('leaves an unrelated image a root', () => {
    const bases = resolveImageBases([
      { id: 'root', layers: BASE },
      { id: 'stranger', layers: UNRELATED },
    ]);

    expect(bases.has('stranger')).toBe(false);
  });

  it('groups every descendant under the same base, whatever the base is', () => {
    // The golden image is not special: `my-python` built on `python3.12-slim`
    // groups exactly the way a workflow image built on the golden image does.
    const slim = [layer('debian'), layer('python')];
    const bases = resolveImageBases([
      { id: 'python3.12-slim', layers: slim },
      { id: 'my-python', layers: [...slim, layer('requirements')] },
      { id: 'my-other-python', layers: [...slim, layer('pandas')] },
    ]);

    expect(bases.get('my-python')).toBe('python3.12-slim');
    expect(bases.get('my-other-python')).toBe('python3.12-slim');
  });

  it('ignores a repeated id and an image with no layers at all', () => {
    const bases = resolveImageBases([
      { id: 'root', layers: BASE },
      { id: 'root', layers: BASE },
      { id: 'empty', layers: [] },
      { id: 'child', layers: CHILD },
    ]);

    expect(bases.get('child')).toBe('root');
    expect(bases.has('empty')).toBe(false);
  });
});

describe('ownImageLabels', () => {
  it('drops the labels the base already carried with the same value', () => {
    expect(
      ownImageLabels(
        {
          'org.opencontainers.image.source': 'https://github.com/rocker-org/rocker-versioned2',
          'mediforce.build.commit': 'abc123',
        },
        { 'org.opencontainers.image.source': 'https://github.com/rocker-org/rocker-versioned2' },
      ),
    ).toEqual({ 'mediforce.build.commit': 'abc123' });
  });

  it('keeps a key the image overrode with its own value', () => {
    expect(
      ownImageLabels(
        { 'org.opencontainers.image.source': 'https://github.com/Appsilon/mediforce' },
        { 'org.opencontainers.image.source': 'https://github.com/rocker-org/rocker-versioned2' },
      ),
    ).toEqual({ 'org.opencontainers.image.source': 'https://github.com/Appsilon/mediforce' });
  });

  it('credits an image with everything when no base is on the daemon', () => {
    expect(ownImageLabels({ maintainer: 'someone' }, undefined)).toEqual({
      maintainer: 'someone',
    });
  });
});

describe('readableBuildStepCommand', () => {
  it('redacts every value docker inlined from a --build-arg', () => {
    const command = readableBuildStepCommand(
      'RUN |2 GITHUB_TOKEN=ghp_realsecret CDISC_RULES_ENGINE_REF=v0.16.0 ' +
        '/bin/sh -c git clone --branch "${CDISC_RULES_ENGINE_REF}" https://github.com/x.git # buildkit',
    );

    expect(command).not.toContain('ghp_realsecret');
    expect(command).not.toContain('v0.16.0');
    expect(command).toBe(
      'RUN GITHUB_TOKEN=*** CDISC_RULES_ENGINE_REF=*** ' +
        'git clone --branch "${CDISC_RULES_ENGINE_REF}" https://github.com/x.git',
    );
  });

  it('redacts a secret baked in outside the build-arg prefix', () => {
    expect(readableBuildStepCommand('ENV NPM_TOKEN=npm_realsecret')).toBe('ENV NPM_TOKEN=***');
    expect(
      readableBuildStepCommand('RUN /bin/sh -c curl -H "x: $API_KEY=abc" https://x # buildkit'),
    ).toContain('API_KEY=***');
  });

  it('redacts credentials embedded in a clone URL', () => {
    expect(
      readableBuildStepCommand(
        'RUN /bin/sh -c git clone https://x-access-token:ghp_realsecret@github.com/o/r.git # buildkit',
      ),
    ).toBe('RUN git clone https://[REDACTED]@github.com/o/r.git');
  });

  it('unwraps the shell and marker docker wraps every step in', () => {
    expect(readableBuildStepCommand('COPY mcp /app/mcp # buildkit')).toBe('COPY mcp /app/mcp');
    expect(readableBuildStepCommand('/bin/sh -c #(nop)  CMD ["/bin/bash"]')).toBe(
      'CMD ["/bin/bash"]',
    );
    expect(readableBuildStepCommand('RUN /bin/sh -c apt-get update # buildkit')).toBe(
      'RUN apt-get update',
    );
    expect(readableBuildStepCommand('/bin/sh -c /rocker_scripts/setup_R.sh')).toBe(
      'RUN /rocker_scripts/setup_R.sh',
    );
  });

  it('leaves a build arg default that carries no secret readable', () => {
    expect(readableBuildStepCommand('ARG CDISC_RULES_ENGINE_REF=v0.16.0')).toBe(
      'ARG CDISC_RULES_ENGINE_REF=v0.16.0',
    );
  });
});

describe('parseImageHistory', () => {
  const rows = [
    { CreatedBy: 'WORKDIR /workspace', Size: '4.1kB' },
    { CreatedBy: 'COPY mcp /app/mcp # buildkit', Size: '430kB' },
    { CreatedBy: 'RUN /bin/sh -c apt-get update # buildkit', Size: '87MB' },
  ];
  const stdout = rows.map((row) => JSON.stringify(row)).join('\n');

  it('returns steps oldest first, tidied', () => {
    expect(parseImageHistory(stdout)).toEqual([
      { command: 'RUN apt-get update', size: '87MB' },
      { command: 'COPY mcp /app/mcp', size: '430kB' },
      { command: 'WORKDIR /workspace', size: '4.1kB' },
    ]);
  });

  it('drops a row that will not parse instead of losing the summary', () => {
    expect(parseImageHistory(`not json\n${JSON.stringify(rows[0])}`)).toEqual([
      { command: 'WORKDIR /workspace', size: '4.1kB' },
    ]);
  });

  it('answers an empty history with no steps', () => {
    expect(parseImageHistory('   ')).toEqual([]);
  });
});

describe('imageStepDelta', () => {
  const step = (command: string) => ({ command, size: '0B' });
  const baseSteps = [step('FROM ubuntu'), step('RUN install R')];

  it('returns only the steps past the base boundary', () => {
    expect(
      imageStepDelta([...baseSteps, step('RUN install teal'), step('COPY mcp /app/mcp')], baseSteps),
    ).toEqual([step('RUN install teal'), step('COPY mcp /app/mcp')]);
  });

  it('adds nothing over itself', () => {
    expect(imageStepDelta(baseSteps, baseSteps)).toEqual([]);
  });

  it('adds nothing when the base summary is the longer one', () => {
    expect(imageStepDelta([step('FROM ubuntu')], baseSteps)).toEqual([]);
  });

  it('is the whole summary for an image with no base', () => {
    expect(imageStepDelta(baseSteps, [])).toEqual(baseSteps);
  });
});
