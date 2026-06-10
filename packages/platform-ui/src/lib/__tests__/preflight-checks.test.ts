import { describe, it, expect } from 'vitest';
import { runPreflightChecks } from '../preflight-checks';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';

const IMAGES: DockerImageInfo[] = [
  { repository: 'mediforce/golden-image', tag: 'latest', id: 'abc', size: '1GB', created: '1d ago' },
  { repository: 'python', tag: '3.11-slim', id: 'def', size: '200MB', created: '2w ago' },
];

function makeDefinition(overrides?: { image?: string; env?: Record<string, string> }) {
  const wd = buildWorkflowDefinition({ name: 'test-wf' });
  wd.steps[0].executor = 'script';
  wd.steps[0].script = { command: 'python run.py', image: overrides?.image ?? 'python:3.11-slim' };
  if (overrides?.env) wd.steps[0].env = overrides.env;
  return wd;
}

describe('runPreflightChecks', () => {
  it('returns no warnings when image exists and no secrets referenced', () => {
    const wd = makeDefinition({ image: 'python:3.11-slim' });
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result).toEqual([]);
  });

  it('warns about missing Docker image grouped by resource', () => {
    const wd = makeDefinition({ image: 'mediforce/nonexistent:v1' });
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'missing-image',
      resource: 'mediforce/nonexistent:v1',
      stepNames: [wd.steps[0].name],
      hint: expect.stringContaining('build source'),
    });
  });

  it('skips image warning when repo + commit configured (engine auto-builds)', () => {
    const wd = makeDefinition({ image: 'mediforce/nonexistent:v1' });
    wd.steps[0].script = { ...wd.steps[0].script, repo: 'git@github.com:org/repo.git', commit: 'abc1234' };
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result.filter((w) => w.category === 'missing-image')).toEqual([]);
  });

  it('skips image check when docker unavailable', () => {
    const wd = makeDefinition({ image: 'mediforce/nonexistent:v1' });
    const result = runPreflightChecks(wd, { dockerAvailable: false, secretKeys: [] });
    expect(result).toEqual([]);
  });

  it('warns about missing secret grouped by key', () => {
    const wd = makeDefinition({ env: { API_KEY: '{{MY_SECRET}}' } });
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'missing-secret',
      resource: 'MY_SECRET',
      stepNames: [wd.steps[0].name],
      hint: expect.stringContaining('Secrets panel'),
    });
  });

  it('no warning when secret is configured', () => {
    const wd = makeDefinition({ env: { API_KEY: '{{MY_SECRET}}' } });
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: ['MY_SECRET'] });
    expect(result.filter((w) => w.category === 'missing-secret')).toEqual([]);
  });

  it('groups same resource across multiple steps', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'script';
    wd.steps[0].script = { command: 'python run.py', image: 'bad:v1' };
    wd.steps[0].env = { KEY: '{{SHARED_SECRET}}' };
    const reviewStep = wd.steps.find((s) => s.type === 'review');
    if (reviewStep) {
      reviewStep.executor = 'agent';
      reviewStep.agent = { image: 'bad:v1' };
      reviewStep.env = { KEY: '{{SHARED_SECRET}}' };
    }
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    const imageWarning = result.find((w) => w.category === 'missing-image');
    const secretWarning = result.find((w) => w.category === 'missing-secret');
    expect(imageWarning?.stepNames.length).toBeGreaterThanOrEqual(2);
    expect(secretWarning?.stepNames.length).toBeGreaterThanOrEqual(2);
  });

  it('detects both missing image and missing secret', () => {
    const wd = makeDefinition({ image: 'bad:v1', env: { KEY: '{{MISSING}}' } });
    const result = runPreflightChecks(wd, { dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    const categories = result.map((w) => w.category);
    expect(categories).toContain('missing-image');
    expect(categories).toContain('missing-secret');
  });

  it('skips human executor steps', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'human';
    wd.steps[0].env = { KEY: '{{SECRET}}' };
    const result = runPreflightChecks(wd, { dockerAvailable: true, secretKeys: [] });
    expect(result).toEqual([]);
  });
});
