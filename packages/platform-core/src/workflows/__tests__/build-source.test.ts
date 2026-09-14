import { describe, it, expect } from 'vitest';
import { stepHasBuildSource } from '../build-source';

describe('stepHasBuildSource', () => {
  const dockerfile = { artifacts: [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }] };
  const skillsRepo = { externalSkillsRepo: { url: 'https://github.com/org/skills.git', commit: 'b'.repeat(40) } };

  it('is true for a repo pinned to a commit', () => {
    expect(stepHasBuildSource(
      { repo: 'https://github.com/org/agent.git', commit: 'a'.repeat(40) },
      undefined,
    )).toBe(true);
  });

  it('is false for a repo with no commit, which builds nothing', () => {
    expect(stepHasBuildSource({ repo: 'https://github.com/org/agent.git' }, undefined)).toBe(false);
  });

  it('is true for a Dockerfile the workflow carries', () => {
    expect(stepHasBuildSource({ dockerfile: 'Dockerfile' }, dockerfile)).toBe(true);
  });

  it('is false for a Dockerfile the workflow does not carry', () => {
    // Naming a file that is not there is not a build source: the step still
    // needs an image, and saying otherwise would leave it with none.
    expect(stepHasBuildSource({ dockerfile: 'container/Dockerfile' }, dockerfile)).toBe(false);
    expect(stepHasBuildSource({ dockerfile: 'Dockerfile' }, undefined)).toBe(false);
    expect(stepHasBuildSource({ dockerfile: 'Dockerfile' }, { artifacts: [] })).toBe(false);
  });

  it('is true for a Dockerfile the workflow\'s skills repo builds from', () => {
    // The runtime falls back to `externalSkillsRepo` for a step naming only a
    // Dockerfile. Missing that here handed the step the golden image, and the
    // build then replaced the shared golden image with this workflow's.
    expect(stepHasBuildSource({ dockerfile: 'container/Dockerfile' }, skillsRepo)).toBe(true);
  });

  it('is false for a skills repo when the step names no Dockerfile', () => {
    expect(stepHasBuildSource({}, skillsRepo)).toBe(false);
  });

  it('is false for a step that names neither', () => {
    expect(stepHasBuildSource({ image: 'python:3.12-slim' }, dockerfile)).toBe(false);
    expect(stepHasBuildSource({}, dockerfile)).toBe(false);
    expect(stepHasBuildSource(undefined, dockerfile)).toBe(false);
  });
});
