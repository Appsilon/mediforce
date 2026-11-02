import {
  InMemoryAgentDefinitionRepository,
  InMemoryAgentRunRepository,
  InMemoryAuditRepository,
  InMemoryEvaluationRepository,
  InMemoryModelRegistryRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryScoreRepository,
  InMemoryToolCatalogRepository,
  buildAgentOutputEnvelope,
  buildAgentRun,
  buildProcessInstance,
  buildStepExecution,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import type { CreateModelRegistryEntryInput, WorkflowStep } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../../auth';
import type { CallerScope } from '../../../repositories/index';
import { createTestScope, userCaller, type TestScopeOverrides } from '../../../repositories/__tests__/create-test-scope';

export const NAMESPACE = 'pharma-a';
export const WORKFLOW = 'ae-grading';
/** The evaluated Step: a subject to query by, and the owner its rows carry. */
export const STEP = { kind: 'step', namespace: NAMESPACE, workflowName: WORKFLOW, stepId: 'grade-aes', agentId: null } as const;
/** What a row of the evaluated Step carries of it. */
export const STEP_OWNER = { namespace: NAMESPACE, workflowName: WORKFLOW, stepId: 'grade-aes', agentId: null } as const;

/** Findings with a grade for every event — passes `{ required: ['findings'] }`. */
export const GRADED_RUN = 'agent-run-graded';
/** A result with no findings key — fails it. */
export const UNGRADED_RUN = 'agent-run-ungraded';

export interface EvaluationFixture {
  readonly processRepo: InMemoryProcessRepository;
  readonly instanceRepo: InMemoryProcessInstanceRepository;
  readonly agentRunRepo: InMemoryAgentRunRepository;
  readonly scoreRepo: InMemoryScoreRepository;
  readonly evaluationRepo: InMemoryEvaluationRepository;
  readonly auditRepo: InMemoryAuditRepository;
  readonly agentDefinitionRepo: InMemoryAgentDefinitionRepository;
  readonly toolCatalogRepo: InMemoryToolCatalogRepository;
  readonly modelRegistryRepo: InMemoryModelRegistryRepository;
  scope(caller?: CallerIdentity, overrides?: TestScopeOverrides): CallerScope;
}

export function registryEntry(id: string, overrides: Partial<CreateModelRegistryEntryInput> = {}): CreateModelRegistryEntryInput {
  return {
    id, name: id, provider: id.split('/')[0]!, contextLength: 200_000, maxCompletionTokens: null,
    pricing: { input: 0.000003, output: 0.000015 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'],
    supportsTools: true, supportsVision: false, source: 'openrouter', canonicalSlug: null, requestCount: null,
    lastSyncedAt: '2026-10-01T00:00:00Z', retiredAt: null, ...overrides,
  };
}

/**
 * An AE-grading workflow whose `grade-aes` agent step binds two MCP servers,
 * and two finished production runs of it: one graded, one not.
 */
export async function evaluationFixture(): Promise<EvaluationFixture> {
  const processRepo = new InMemoryProcessRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
  const scoreRepo = new InMemoryScoreRepository();
  const evaluationRepo = new InMemoryEvaluationRepository();
  const auditRepo = new InMemoryAuditRepository(instanceRepo);
  const agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
  const toolCatalogRepo = new InMemoryToolCatalogRepository();
  await toolCatalogRepo.upsert(NAMESPACE, { id: 'edc', type: 'stdio', command: 'edc-mcp' });
  await toolCatalogRepo.upsert(NAMESPACE, { id: 'email', type: 'http', url: 'https://mcp.example.com/email' });
  const modelRegistryRepo = new InMemoryModelRegistryRepository();
  for (const id of ['anthropic/claude-sonnet-5', 'openai/gpt-5']) {
    await modelRegistryRepo.upsert(registryEntry(id));
  }

  await agentDefinitionRepo.upsert('ae-grader', {
    kind: 'plugin',
    name: 'AE grader',
    iconName: 'bot',
    description: 'Grades adverse events by CTCAE v5',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: 'You grade adverse events.',
    inputDescription: 'Extracted AEs',
    outputDescription: 'Graded AEs',
    mcpServers: {
      edc: { type: 'stdio', catalogId: 'edc', allowedTools: ['read_record', 'write_record'] },
      email: { type: 'http', catalogId: 'email' },
    },
    namespace: NAMESPACE,
    visibility: 'private',
  });
  await processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
    name: WORKFLOW,
    namespace: NAMESPACE,
    steps: [
      { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', script: { runtime: 'python', inlineScript: 'print(1)' } },
      { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: 'ae-grader', agent: { prompt: 'Grade each AE.' } },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'extract-aes', to: 'grade-aes' }, { from: 'grade-aes', to: 'done' }],
  }));

  const fixture: EvaluationFixture = {
    processRepo,
    instanceRepo,
    agentRunRepo,
    scoreRepo,
    evaluationRepo,
    auditRepo,
    agentDefinitionRepo,
    toolCatalogRepo,
    modelRegistryRepo,
    scope: (caller = userCaller('author-1', [NAMESPACE]), overrides = {}) => createTestScope({
      ...overrides,
      processRepo,
      instanceRepo,
      agentRunRepo,
      scoreRepo,
      evaluationRepo,
      auditRepo,
      agentDefinitionRepo,
      toolCatalogRepo,
      modelRegistryRepo,
      caller,
    }),
  };
  await addStepRun(fixture, { instanceId: 'run-graded', agentRunId: GRADED_RUN, result: { findings: [{ term: 'Sepsis', grade: 5 }] }, at: '2026-09-22T09:00:00.000Z' });
  await addStepRun(fixture, { instanceId: 'run-ungraded', agentRunId: UNGRADED_RUN, result: { summary: 'ungraded' }, at: '2026-09-22T10:00:00.000Z' });
  return fixture;
}

/**
 * One finished production run of `grade-aes`, fed the extracted AEs by the
 * step before it. With `gitMetadata`, the commit it produced on the run branch.
 */
export async function addStepRun(fixture: EvaluationFixture, run: {
  instanceId: string;
  agentRunId: string;
  result: Record<string, unknown>;
  at: string;
  gitMetadata?: { repoUrl: string; commitSha: string };
}): Promise<void> {
  const extracted = { events: [{ term: 'Sepsis', outcome: 'fatal' }] };
  await fixture.instanceRepo.create(buildProcessInstance({
    id: run.instanceId,
    namespace: NAMESPACE,
    definitionName: WORKFLOW,
    triggerPayload: { studyId: 'CDISCPILOT01' },
    variables: { 'extract-aes': extracted },
  }));
  await fixture.instanceRepo.addStepExecution(run.instanceId, buildStepExecution({
    instanceId: run.instanceId,
    stepId: 'grade-aes',
    input: { ...extracted, steps: { 'extract-aes': extracted } },
    startedAt: run.at,
  }));
  await fixture.agentRunRepo.create(buildAgentRun({
    id: run.agentRunId,
    processInstanceId: run.instanceId,
    stepId: 'grade-aes',
    startedAt: run.at,
    envelope: buildAgentOutputEnvelope({
      result: run.result,
      ...(run.gitMetadata === undefined ? {} : {
        gitMetadata: { ...run.gitMetadata, branch: `run/${run.instanceId}`, changedFiles: ['graded.json'] },
      }),
    }),
  }));
}

/**
 * A workflow in the test workspace whose `grade` step runs the AE grader with
 * `step` added to it, and one finished production run of it.
 */
export async function addAgentWorkflowRun(fixture: EvaluationFixture, run: {
  workflowName: string;
  step?: Partial<WorkflowStep>;
  agentRunId: string;
  result: Record<string, unknown>;
  at: string;
  stepInput?: Record<string, unknown>;
  triggerPayload?: Record<string, unknown>;
}): Promise<void> {
  await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
    name: run.workflowName,
    namespace: NAMESPACE,
    steps: [
      { id: 'grade', name: 'Grade', type: 'creation', executor: 'agent', agentId: 'ae-grader', ...run.step },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'grade', to: 'done' }],
  }));
  const instanceId = `instance-${run.agentRunId}`;
  await fixture.instanceRepo.create(buildProcessInstance({
    id: instanceId,
    namespace: NAMESPACE,
    definitionName: run.workflowName,
    triggerPayload: run.triggerPayload ?? { studyId: 'CDISCPILOT01' },
  }));
  await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({
    instanceId,
    stepId: 'grade',
    input: run.stepInput ?? { term: 'Sepsis', steps: {} },
    startedAt: run.at,
  }));
  await fixture.agentRunRepo.create(buildAgentRun({
    id: run.agentRunId,
    processInstanceId: instanceId,
    stepId: 'grade',
    startedAt: run.at,
    envelope: buildAgentOutputEnvelope({ result: run.result }),
  }));
}

/** Stores a `schema` Evaluator beside one the handler already refuses to duplicate, as a step edited before the one-schema limit has. */
export async function seedSchemaEvaluator(
  scope: CallerScope,
  evaluator: { name: string; rule: string; required: string[] },
): Promise<void> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await scope.evaluation.createEvaluator(
    { ...STEP, id, name: evaluator.name, archived: false, runInProduction: false, onError: 'ignore', createdBy: 'author-1', createdAt },
    { evaluatorId: id, version: 1, rule: evaluator.rule, check: { kind: 'schema', schema: { required: evaluator.required } }, origin: 'user', sourceApproval: null, createdBy: 'author-1', createdAt },
  );
}
