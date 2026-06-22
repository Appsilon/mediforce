import { describe, it, expect } from 'vitest';
import { runPreflightChecks } from '../preflight-checks';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';

const IMAGES: DockerImageInfo[] = [
  { repository: 'mediforce/golden-image', tag: 'latest', id: 'abc', size: '1GB', created: '1d ago' },
  { repository: 'python', tag: '3.11-slim', id: 'def', size: '200MB', created: '2w ago' },
];

const BASE_CTX = { handle: 'acme', workflowName: 'my-wf', version: 3 };

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
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result).toEqual([]);
  });

  it('warns about missing Docker image with actionable paths', () => {
    const wd = makeDefinition({ image: 'mediforce/nonexistent:v1' });
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result).toHaveLength(1);
    const w = result[0];
    expect(w.category).toBe('missing-image');
    expect(w.resource).toBe('mediforce/nonexistent:v1');
    expect(w.stepNames).toEqual([wd.steps[0].name]);
    const labels = w.actions.map((a) => a.label);
    expect(labels).toContain('Configure build source');
    expect(labels).toContain('Build manually');
    expect(labels).not.toContain('Contact admin');
  });

  it('includes Contact admin action when adminEmail provided', () => {
    const wd = makeDefinition({ image: 'bad:v1' });
    const result = runPreflightChecks(wd, {
      ...BASE_CTX,
      dockerImages: IMAGES,
      dockerAvailable: true,
      secretKeys: [],
      adminEmail: 'admin@acme.test',
    });
    const w = result[0];
    const adminAction = w.actions.find((a) => a.label === 'Contact admin');
    expect(adminAction?.href).toBe('mailto:admin@acme.test');
  });

  it('Configure build source href deep-links to definition editor', () => {
    const wd = makeDefinition({ image: 'bad:v1' });
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    const action = result[0].actions.find((a) => a.label === 'Configure build source');
    expect(action?.href).toBe('/acme/workflows/my-wf/definitions/3');
  });

  it('Configure build source falls back to workflow page when version unknown', () => {
    const wd = makeDefinition({ image: 'bad:v1' });
    const result = runPreflightChecks(wd, { handle: 'acme', workflowName: 'my-wf', dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    const action = result[0].actions.find((a) => a.label === 'Configure build source');
    expect(action?.href).toBe('/acme/workflows/my-wf');
  });

  it('skips image warning when repo + commit configured (engine auto-builds)', () => {
    const wd = makeDefinition({ image: 'mediforce/nonexistent:v1' });
    wd.steps[0].script = { ...wd.steps[0].script, repo: 'git@github.com:org/repo.git', commit: 'abc1234' };
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result.filter((w) => w.category === 'missing-image')).toEqual([]);
  });

  it('skips image check when docker unavailable', () => {
    const wd = makeDefinition({ image: 'mediforce/nonexistent:v1' });
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerAvailable: false, secretKeys: [] });
    expect(result).toEqual([]);
  });

  it('warns about missing secret with Secrets panel link', () => {
    const wd = makeDefinition({ env: { API_KEY: '{{MY_SECRET}}' } });
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    expect(result).toHaveLength(1);
    const w = result[0];
    expect(w.category).toBe('missing-secret');
    expect(w.resource).toBe('MY_SECRET');
    expect(w.stepNames).toEqual([wd.steps[0].name]);
    const action = w.actions.find((a) => a.label === 'Configure in Secrets panel');
    expect(action?.href).toContain('?tab=secrets&setup=MY_SECRET');
  });

  it('no warning when secret is configured', () => {
    const wd = makeDefinition({ env: { API_KEY: '{{MY_SECRET}}' } });
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: ['MY_SECRET'] });
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
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    const imageWarning = result.find((w) => w.category === 'missing-image');
    const secretWarning = result.find((w) => w.category === 'missing-secret');
    expect(imageWarning?.stepNames.length).toBeGreaterThanOrEqual(2);
    expect(secretWarning?.stepNames.length).toBeGreaterThanOrEqual(2);
  });

  it('detects both missing image and missing secret', () => {
    const wd = makeDefinition({ image: 'bad:v1', env: { KEY: '{{MISSING}}' } });
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] });
    const categories = result.map((w) => w.category);
    expect(categories).toContain('missing-image');
    expect(categories).toContain('missing-secret');
  });

  it('skips human executor steps', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'human';
    wd.steps[0].env = { KEY: '{{SECRET}}' };
    const result = runPreflightChecks(wd, { ...BASE_CTX, dockerAvailable: true, secretKeys: [] });
    expect(result).toEqual([]);
  });

  it('warns about unknown model with suggestion', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { model: 'anthropic/claude-haiku-3.5' };
    const result = runPreflightChecks(wd, {
      ...BASE_CTX,
      dockerAvailable: true,
      secretKeys: [],
      modelValidation: {
        unknown: [{ id: 'anthropic/claude-haiku-3.5', suggestion: 'anthropic/claude-3.5-haiku' }],
      },
    });
    const w = result.find((r) => r.category === 'unknown-model');
    expect(w).toBeDefined();
    expect(w!.resource).toBe('anthropic/claude-haiku-3.5');
    expect(w!.message).toContain('did you mean');
    expect(w!.message).toContain('anthropic/claude-3.5-haiku');
    expect(w!.stepNames).toEqual([wd.steps[0].name]);
    expect(w!.actions).toHaveLength(1);
    expect(w!.actions[0].label).toBe('Edit workflow');
  });

  it('warns about unknown model without suggestion', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { model: 'sonnet' };
    const result = runPreflightChecks(wd, {
      ...BASE_CTX,
      dockerAvailable: true,
      secretKeys: [],
      modelValidation: {
        unknown: [{ id: 'sonnet', suggestion: null }],
      },
    });
    const w = result.find((r) => r.category === 'unknown-model');
    expect(w).toBeDefined();
    expect(w!.message).toBe("Model 'sonnet' not found in registry");
    expect(w!.message).not.toContain('did you mean');
  });

  it('skips model check when modelValidation not provided', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { model: 'unknown-model' };
    const result = runPreflightChecks(wd, {
      ...BASE_CTX,
      dockerAvailable: true,
      secretKeys: [],
    });
    expect(result.filter((r) => r.category === 'unknown-model')).toEqual([]);
  });
});
