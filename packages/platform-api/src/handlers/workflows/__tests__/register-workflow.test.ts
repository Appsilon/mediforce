import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryModelRegistryRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { registerWorkflow } from '../register-workflow';
import { ValidationError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { fetchFromContainerWorker } from '../../system/_docker';

vi.mock('../../system/_docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system/_docker')>();
  return {
    ...actual,
    isLocalAgentMode: vi.fn().mockReturnValue(false),
    fetchFromContainerWorker: vi.fn().mockResolvedValue({ available: false }),
    fetchFromLocalDocker: vi.fn().mockResolvedValue({ available: false }),
  };
});

describe('registerWorkflow handler', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  it('registerWorkflow stores a new workflow and emits workflow.created audit', async () => {
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'flow-new',
      namespace: 'team-alpha',
    });
    body.steps[1].agent = { image: 'test-image' };
    const { version: _omitVersion, createdAt: _omitCreatedAt, namespace: _omitNamespace, ...input } = body;

    const result = await registerWorkflow(
      { ...input, namespace: 'team-alpha' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'flow-new', version: 1 });
    const stored = await processRepo.getWorkflowDefinition('team-alpha', 'flow-new', 1);
    expect(stored?.name).toBe('flow-new');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.created');
    expect(events[0].actorId).toBe('user-42');
  });

  it('rejects a workflow whose graph is incomplete — a step with no outgoing transition and unreachable from later steps', async () => {
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'flow-broken-graph',
      namespace: 'team-alpha',
      transitions: [{ from: 'intake', to: 'review' }],
    });
    const { version: _omitVersion, createdAt: _omitCreatedAt, namespace: _omitNamespace, ...input } = body;

    await expect(registerWorkflow(
      { ...input, namespace: 'team-alpha' },
      scope,
    )).rejects.toThrow(ValidationError);

    const stored = await processRepo.getWorkflowDefinition('team-alpha', 'flow-broken-graph', 1);
    expect(stored).toBeNull();
  });

  it('rejects workflow with retired model in agent step', async () => {
    const retiredModelRepo = new InMemoryModelRegistryRepository();
    await retiredModelRepo.upsert({
      id: 'openai/gpt-4',
      canonicalSlug: null,
      name: 'GPT-4',
      provider: 'openai',
      contextLength: 8192,
      maxCompletionTokens: null,
      pricing: { input: 0.03, output: 0.06 },
      modality: 'text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: false,
      source: 'openrouter',
      requestCount: null,
      lastSyncedAt: '2026-01-01T00:00:00Z',
      retiredAt: '2026-01-15T00:00:00Z',
    });
    const scope = createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', ['team-alpha']),
      modelRegistryRepo: retiredModelRepo,
    });
    const body = buildWorkflowDefinition({
      name: 'retired-flow',
      namespace: 'team-alpha',
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'review', executor: 'agent', autonomyLevel: 'L2', agent: { model: 'openai/gpt-4' } },
        { id: 'complete', name: 'Complete', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'complete' }],
    });
    const { version: _v, createdAt: _c, namespace: _n, ...input } = body;

    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(ValidationError);
    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(/openai\/gpt-4/);
    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(/retired/i);
    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .rejects.toThrow(/Analyze/);
  });

  it('accepts workflow when models are not retired', async () => {
    const activeModelRepo = new InMemoryModelRegistryRepository();
    await activeModelRepo.upsert({
      id: 'anthropic/claude-sonnet-4',
      canonicalSlug: null,
      name: 'Claude Sonnet 4',
      provider: 'anthropic',
      contextLength: 200000,
      maxCompletionTokens: null,
      pricing: { input: 0.003, output: 0.015 },
      modality: 'text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: true,
      source: 'openrouter',
      requestCount: null,
      lastSyncedAt: '2026-01-01T00:00:00Z',
      retiredAt: null,
    });
    const scope = createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', ['team-alpha']),
      modelRegistryRepo: activeModelRepo,
    });
    const body = buildWorkflowDefinition({
      name: 'active-flow',
      namespace: 'team-alpha',
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'review', executor: 'agent', autonomyLevel: 'L2', agent: { model: 'anthropic/claude-sonnet-4', image: 'test-image' } },
        { id: 'complete', name: 'Complete', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'complete' }],
    });
    const { version: _v, createdAt: _c, namespace: _n, ...input } = body;

    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .resolves.toMatchObject({ success: true, name: 'active-flow' });
  });

  it('defaults agent step without Docker image to the golden image when not in local agent mode', async () => {
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'no-image-flow',
      namespace: 'team-alpha',
      steps: [
        { id: 'analyze', name: 'AI Analysis', type: 'creation', executor: 'agent', autonomyLevel: 'L2', agent: { model: 'anthropic/claude-sonnet-4', prompt: 'Analyze' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });
    const { version: _v, createdAt: _c, namespace: _n, ...input } = body;

    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .resolves.toMatchObject({ success: true, name: 'no-image-flow' });
    const stored = await processRepo.getWorkflowDefinition('team-alpha', 'no-image-flow', 1);
    const analyzeStep = stored?.steps.find((s) => s.id === 'analyze');
    expect(analyzeStep?.agent?.image).toBe('mediforce-golden-image');
  });

  it('accepts agent step without image when repo + commit configured (auto-build)', async () => {
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'auto-build-flow',
      namespace: 'team-alpha',
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent', autonomyLevel: 'L2', agent: { model: 'anthropic/claude-sonnet-4', prompt: 'Analyze', repo: 'git@github.com:org/repo.git', commit: 'abc1234' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });
    const { version: _v, createdAt: _c, namespace: _n, ...input } = body;

    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .resolves.toMatchObject({ success: true, name: 'auto-build-flow' });
  });

  it('accepts agent step with Docker image configured', async () => {
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'with-image-flow',
      namespace: 'team-alpha',
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent', autonomyLevel: 'L2', agent: { model: 'anthropic/claude-sonnet-4', prompt: 'Analyze', image: 'mediforce-golden-image' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });
    const { version: _v, createdAt: _c, namespace: _n, ...input } = body;

    await expect(registerWorkflow({ ...input, namespace: 'team-alpha' }, scope))
      .resolves.toMatchObject({ success: true, name: 'with-image-flow' });
  });

  it('returns warning when Docker image not found on platform', async () => {
    vi.mocked(fetchFromContainerWorker).mockResolvedValueOnce({
      available: true,
      images: [
        { repository: 'mediforce-golden-image', tag: 'latest', id: 'abc', size: '1GB', created: '1d ago' },
      ],
      disk: { images: { totalCount: 1, size: '1GB' }, containers: { totalCount: 0, active: 0, size: '0B' }, buildCache: { size: '0B' } },
    });
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'warning-flow',
      namespace: 'team-alpha',
      steps: [
        { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent', autonomyLevel: 'L2', agent: { model: 'anthropic/claude-sonnet-4', prompt: 'Analyze', image: 'nonexistent-image:v1' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyze', to: 'done' }],
    });
    const { version: _v, createdAt: _c, namespace: _n, ...input } = body;

    const result = await registerWorkflow({ ...input, namespace: 'team-alpha' }, scope);

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0].code).toBe('image-not-found');
    expect(result.warnings![0].message).toContain('nonexistent-image:v1');
    expect(result.warnings![0].stepName).toBe('Analyze');
  });

  it('registerWorkflow bumps version and emits workflow.version_added audit when name already exists', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-existing', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'flow-existing',
      namespace: 'team-alpha',
    });
    body.steps[1].agent = { image: 'test-image' };
    const { version: _omitVersion, createdAt: _omitCreatedAt, namespace: _omitNamespace, ...input } = body;

    const result = await registerWorkflow(
      { ...input, namespace: 'team-alpha' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'flow-existing', version: 2 });
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.version_added');
  });
});
