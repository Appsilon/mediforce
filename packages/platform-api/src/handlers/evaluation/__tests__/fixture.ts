import {
  InMemoryAgentDefinitionRepository,
  InMemoryAgentRunRepository,
  InMemoryAuditRepository,
  InMemoryEvaluationRepository,
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
import type { CallerIdentity } from '../../../auth';
import type { CallerScope } from '../../../repositories/index';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

export const NAMESPACE = 'pharma-a';
export const WORKFLOW = 'ae-grading';
export const STEP = { namespace: NAMESPACE, workflowName: WORKFLOW, stepId: 'grade-aes' } as const;

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
  scope(caller?: CallerIdentity): CallerScope;
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
  await toolCatalogRepo.upsert(NAMESPACE, { id: 'edc', command: 'edc-mcp' });

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
      email: { type: 'http', url: 'https://mcp.example.com/email' },
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
    scope: (caller = userCaller('author-1', [NAMESPACE])) => createTestScope({
      processRepo,
      instanceRepo,
      agentRunRepo,
      scoreRepo,
      evaluationRepo,
      auditRepo,
      agentDefinitionRepo,
      toolCatalogRepo,
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
