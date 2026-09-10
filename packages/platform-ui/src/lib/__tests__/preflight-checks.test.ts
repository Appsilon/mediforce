import { describe, it, expect } from 'vitest';
import { runPreflightChecks, findSkippedChecks, collectSecretReferences } from '../preflight-checks';
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

describe('findSkippedChecks', () => {
  const ALL_RAN = { dockerAvailable: true, creditsFailed: false, modelValidationFailed: false };

  function agentDefinition() {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { model: 'anthropic/claude-sonnet-4', image: 'python:3.11-slim' };
    return wd;
  }

  it('reports nothing when every relevant check completed', () => {
    expect(findSkippedChecks(agentDefinition(), ALL_RAN)).toEqual([]);
  });

  it('reports the image check when the registry is unreachable and a step names an image', () => {
    expect(findSkippedChecks(agentDefinition(), { ...ALL_RAN, dockerAvailable: false }))
      .toEqual(['images']);
  });

  it('does not report the image check when no step names an image to look up', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'human';
    expect(findSkippedChecks(wd, { ...ALL_RAN, dockerAvailable: false })).toEqual([]);
  });

  it('does not report the image check for a step built from source', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'script';
    wd.steps[0].script = { command: 'python run.py', image: 'built:latest', repo: 'org/repo', commit: 'abc123' };
    expect(findSkippedChecks(wd, { ...ALL_RAN, dockerAvailable: false })).toEqual([]);
  });

  it('reports the model check when model validation errored', () => {
    expect(findSkippedChecks(agentDefinition(), { ...ALL_RAN, modelValidationFailed: true }))
      .toEqual(['models']);
  });

  it('does not report the model check when no agent step names a model', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'human';
    expect(findSkippedChecks(wd, { ...ALL_RAN, modelValidationFailed: true })).toEqual([]);
  });

  it('reports the credits check when the credits probe failed and the workflow has agent steps', () => {
    expect(findSkippedChecks(agentDefinition(), { ...ALL_RAN, creditsFailed: true }))
      .toEqual(['credits']);
  });

  it('does not report the credits check for a workflow with no agent steps', () => {
    const wd = buildWorkflowDefinition({
      name: 'test-wf',
      steps: [
        {
          id: 'transform',
          name: 'Transform',
          type: 'creation',
          executor: 'script',
          script: { command: 'python run.py', image: 'python:3.11-slim' },
        },
      ],
      transitions: [],
    });
    expect(findSkippedChecks(wd, { ...ALL_RAN, creditsFailed: true })).toEqual([]);
  });

  it('reports every check that could not run', () => {
    const skipped = findSkippedChecks(agentDefinition(), {
      dockerAvailable: false,
      creditsFailed: true,
      modelValidationFailed: true,
    });
    expect(skipped.sort()).toEqual(['credits', 'images', 'models']);
  });
});

describe('collectSecretReferences', () => {
  it('collects the secret keys a definition references, with their env var', () => {
    const wd = makeDefinition({ env: { API_KEY: '{{MY_SECRET}}' } });
    expect(collectSecretReferences(wd)).toEqual([
      { key: 'MY_SECRET', envVar: 'API_KEY', stepNames: [wd.steps[0].name] },
    ]);
  });

  it('groups one key referenced by several steps', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'script';
    wd.steps[0].script = { command: 'python run.py', image: 'python:3.11-slim' };
    wd.steps[0].env = { KEY: '{{SHARED_SECRET}}' };
    const reviewStep = wd.steps.find((s) => s.type === 'review');
    if (reviewStep) {
      reviewStep.executor = 'agent';
      reviewStep.agent = { image: 'python:3.11-slim' };
      reviewStep.env = { KEY: '{{SHARED_SECRET}}' };
    }
    const references = collectSecretReferences(wd);
    expect(references).toHaveLength(1);
    expect(references[0].stepNames.length).toBeGreaterThanOrEqual(2);
  });

  it('includes workflow-level env inherited by container steps', () => {
    const wd = makeDefinition();
    wd.env = { SHARED: '{{WORKFLOW_SECRET}}' };
    expect(collectSecretReferences(wd).map((r) => r.key)).toContain('WORKFLOW_SECRET');
  });

  it('ignores plain values and human steps', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'human';
    wd.steps[0].env = { KEY: '{{HUMAN_SECRET}}' };
    const reviewStep = wd.steps.find((s) => s.type === 'review');
    if (reviewStep) {
      reviewStep.executor = 'script';
      reviewStep.script = { command: 'echo hi', image: 'python:3.11-slim' };
      reviewStep.env = { LITERAL: 'not-a-template' };
    }
    expect(collectSecretReferences(wd)).toEqual([]);
  });

  it('ignores OAUTH templates, which no secret row can satisfy', () => {
    const wd = makeDefinition({ env: { GITHUB_TOKEN: '{{OAUTH:github}}', API_KEY: '{{SECRET:my_key}}' } });
    expect(collectSecretReferences(wd).map((r) => r.key)).toEqual(['my_key']);
  });

  it('returns nothing for a definition without steps', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    // @ts-expect-error — a stale bundle can deliver a definition without steps
    wd.steps = undefined;
    expect(collectSecretReferences(wd)).toEqual([]);
  });
});

// A definition can name a file it does not carry — pasted from a package whose
// files live in a repo, or written with a command typed before the file was
// uploaded. The run fails at the container otherwise, with no clue why.
describe('runPreflightChecks — files the workflow references but does not carry', () => {
  const ctx = { ...BASE_CTX, dockerImages: IMAGES, dockerAvailable: true, secretKeys: [] };

  function withScript(command: string, artifacts?: { path: string; contents: string }[]) {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].name = 'Poll';
    wd.steps[0].executor = 'script';
    wd.steps[0].script = { command, image: 'python:3.11-slim' };
    if (artifacts) wd.artifacts = artifacts;
    return wd;
  }

  it('warns about a command that names a file the workflow does not carry', () => {
    const result = runPreflightChecks(withScript('python3 /artifacts/scripts/poll.py'), ctx);
    const warning = result.find((w) => w.category === 'missing-file');
    expect(warning?.resource).toBe('scripts/poll.py');
    expect(warning?.stepNames).toEqual(['Poll']);
    expect(warning?.message).toMatch(/does not carry/i);
    expect(warning?.actions.map((a) => a.label)).toContain('Add the file');
  });

  it('says nothing when the file is there', () => {
    const result = runPreflightChecks(
      withScript('python3 /artifacts/scripts/poll.py', [{ path: 'scripts/poll.py', contents: 'print(1)\n' }]),
      ctx,
    );
    expect(result.filter((w) => w.category === 'missing-file')).toEqual([]);
  });

  it('reports one file once, listing every step that needs it', () => {
    const wd = withScript('python3 /artifacts/shared.py');
    wd.steps.push({
      id: 'second', name: 'Second', type: 'creation', executor: 'script',
      script: { command: 'python3 /artifacts/shared.py', image: 'python:3.11-slim' },
    });
    const result = runPreflightChecks(wd, ctx);
    const warnings = result.filter((w) => w.category === 'missing-file');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].stepNames).toEqual(['Poll', 'Second']);
  });

  it('ignores a path that has nothing to do with the workflow files', () => {
    // `/output` and `/workspace` are the engine's own mounts, and a bare
    // argument is not a path at all.
    const result = runPreflightChecks(withScript('python3 /output/script.py --input /workspace/data'), ctx);
    expect(result.filter((w) => w.category === 'missing-file')).toEqual([]);
  });

  it('warns about a Dockerfile the step names and nothing provides', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].name = 'Interpret';
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { dockerfile: 'Dockerfile' };
    const result = runPreflightChecks(wd, ctx);
    const warning = result.find((w) => w.category === 'missing-file');
    expect(warning?.resource).toBe('Dockerfile');
    expect(warning?.message).toMatch(/cannot be built/i);
  });

  it('says nothing about a Dockerfile that is carried, or one built from a repo', () => {
    const carried = buildWorkflowDefinition({ name: 'test-wf' });
    carried.steps[0].executor = 'agent';
    carried.steps[0].agent = { dockerfile: 'Dockerfile' };
    carried.artifacts = [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }];
    expect(runPreflightChecks(carried, ctx).filter((w) => w.category === 'missing-file')).toEqual([]);

    const fromRepo = buildWorkflowDefinition({ name: 'test-wf' });
    fromRepo.steps[0].executor = 'agent';
    fromRepo.steps[0].agent = {
      dockerfile: 'Dockerfile',
      repo: 'https://github.com/org/agent.git',
      commit: 'a'.repeat(40),
    };
    expect(runPreflightChecks(fromRepo, ctx).filter((w) => w.category === 'missing-file')).toEqual([]);
  });

  it('says nothing about a skills directory, which may live in the checkout', () => {
    // `skillsDir` resolves against the repository mounted on the host when the
    // workflow neither carries the skills nor names an `externalSkillsRepo`,
    // and the browser cannot see that filesystem. Warning here would fire on
    // every workflow that ships in the repo.
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { skill: 'validator', skillsDir: 'apps/landing-zone/plugins/landing-zone/skills' };
    expect(runPreflightChecks(wd, ctx).filter((w) => w.category === 'missing-file')).toEqual([]);
  });
});

describe('runPreflightChecks — an input contract the first step asks for again', () => {
  const ctx = { dockerAvailable: false, handle: 'acme', workflowName: 'test-wf' };

  it('warns when a required trigger input is also a param on the entry step', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.triggerInput = [
      { name: 'app_name', type: 'string', required: true },
      { name: 'app_description', type: 'textarea', required: true },
    ];
    wd.steps[0].name = 'Collect requirements';
    wd.steps[0].executor = 'human';
    wd.steps[0].params = [
      { name: 'app_name', type: 'string', required: true },
      { name: 'app_description', type: 'textarea', required: true },
    ];

    const warning = runPreflightChecks(wd, ctx).find((w) => w.category === 'contract-collected-twice');
    expect(warning?.resource).toBe('app_name, app_description');
    expect(warning?.stepNames).toEqual(['Collect requirements']);
    expect(warning?.message).toMatch(/cannot start/i);
  });

  it('says nothing when the entry step asks for something else', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.triggerInput = [{ name: 'study_id', type: 'string', required: true }];
    wd.steps[0].executor = 'human';
    wd.steps[0].params = [{ name: 'comment', type: 'string', required: false }];

    expect(runPreflightChecks(wd, ctx).filter((w) => w.category === 'contract-collected-twice')).toEqual([]);
  });

  it('says nothing when the duplicated field is optional, since the run can still start', () => {
    const wd = buildWorkflowDefinition({ name: 'test-wf' });
    wd.triggerInput = [{ name: 'app_name', type: 'string', required: false }];
    wd.steps[0].executor = 'human';
    wd.steps[0].params = [{ name: 'app_name', type: 'string', required: true }];

    expect(runPreflightChecks(wd, ctx).filter((w) => w.category === 'contract-collected-twice')).toEqual([]);
  });
});
