import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { ensureStepImageBuilt } from '../dry-run-image';
import { artifactsDir } from '../workflow-artifacts';

const ensured: unknown[] = [];
vi.mock('../docker-spawn-strategy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../docker-spawn-strategy')>();
  return {
    ...actual,
    getDockerSpawnStrategy: () => ({
      supportsLiveStreaming: true,
      spawn: vi.fn(),
      ensureImage: vi.fn(async (build: unknown) => { ensured.push(build); }),
    }),
  };
});

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'landing-zone',
    namespace: 'acme',
    version: 1,
    visibility: 'private',
    steps: [],
    transitions: [],
    ...overrides,
  } as WorkflowDefinition;
}

const agentStep = (agent: Record<string, unknown>): WorkflowStep => ({
  id: 'interpret', name: 'Interpret', type: 'creation', executor: 'agent', agent,
} as WorkflowStep);

beforeEach(() => { ensured.length = 0; });

describe('ensureStepImageBuilt', () => {
  it('builds the image a step would need, from the Dockerfile the workflow carries', async () => {
    const artifacts = [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }];
    const built = await ensureStepImageBuilt(
      agentStep({ dockerfile: 'Dockerfile' }),
      definition({ artifacts }),
    );

    expect(built?.image).toMatch(/^mediforce-artifacts:/);
    expect(ensured).toHaveLength(1);
    expect((ensured[0] as { contextDir?: string }).contextDir).toBe(artifactsDir(artifacts));
  });

  it('writes the files first, so the build has a context to read', async () => {
    // The context directory is where `materializeArtifacts` puts them, and a
    // build against a directory that was never written fails on the Dockerfile.
    const artifacts = [{ path: 'Dockerfile', contents: 'FROM alpine:3.19\n' }];
    await ensureStepImageBuilt(agentStep({ dockerfile: 'Dockerfile' }), definition({ artifacts }));

    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(existsSync(join(artifactsDir(artifacts), 'Dockerfile'))).toBe(true);
  });

  it('builds from a repo when that is what the step names', async () => {
    const built = await ensureStepImageBuilt(
      agentStep({ dockerfile: 'Dockerfile', repo: 'https://github.com/org/agent.git', commit: 'a'.repeat(40) }),
      definition(),
    );
    expect(built?.commit).toBe('a'.repeat(40));
    expect(ensured).toHaveLength(1);
  });

  it('does nothing for a step that names a ready-made image', async () => {
    // Nothing to build: an image that is pulled or already on the host is not
    // this workflow's to compile, and a dry run should not go near the network.
    const built = await ensureStepImageBuilt(agentStep({ image: 'python:3.12-slim' }), definition());
    expect(built).toBeNull();
    expect(ensured).toEqual([]);
  });

  it('does nothing for a human step', async () => {
    const step = { id: 'review', name: 'Review', type: 'creation', executor: 'human' } as WorkflowStep;
    expect(await ensureStepImageBuilt(step, definition())).toBeNull();
    expect(ensured).toEqual([]);
  });

  it('builds for a script step too, which is the same container class', async () => {
    const artifacts = [{ path: 'container/Dockerfile', contents: 'FROM python:3.12-slim\n' }];
    const step = {
      id: 'poll', name: 'Poll', type: 'creation', executor: 'script',
      script: { command: 'python3 /artifacts/poll.py', dockerfile: 'container/Dockerfile' },
    } as WorkflowStep;

    const built = await ensureStepImageBuilt(step, definition({ artifacts }));
    expect(built?.dockerfile).toBe('container/Dockerfile');
    expect(ensured).toHaveLength(1);
  });
});
