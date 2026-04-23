import type {
  ProcessDefinition,
  ProcessInstance,
  StepExecution,
  HumanTask,
  AgentRun,
  AuditEvent,
  ProcessConfig,
  AgentOutputEnvelope,
  FileMetadata,
} from '../index.js';
import type { WorkflowDefinition } from '../schemas/workflow-definition.js';
import type { CoworkSession } from '../schemas/cowork-session.js';

// ---------------------------------------------------------------------------
// Internal counter for deterministic sequential IDs
// ---------------------------------------------------------------------------
let _seq = 0;

/** Reset the internal sequence counter (useful between test suites). */
export function resetFactorySequence(): void {
  _seq = 0;
}

function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${String(_seq).padStart(4, '0')}`;
}

/** Fixed timestamp used as the default across all factories. */
const DEFAULT_TIMESTAMP = '2026-01-15T10:00:00Z';
const DEFAULT_UPDATED_TIMESTAMP = '2026-01-15T10:05:00Z';

// ---------------------------------------------------------------------------
// buildProcessDefinition
// ---------------------------------------------------------------------------

export function buildProcessDefinition(
  overrides?: Partial<ProcessDefinition>,
): ProcessDefinition {
  const id = nextId('proc-def');
  return {
    name: `process-${id}`,
    version: '1.0',
    steps: [
      {
        id: 'step-intake',
        name: 'Intake',
        type: 'creation',
      },
      {
        id: 'step-review',
        name: 'Compliance Review',
        type: 'review',
        verdicts: {
          approve: { target: 'step-complete' },
          reject: { target: 'step-closed' },
        },
      },
      {
        id: 'step-complete',
        name: 'Complete',
        type: 'terminal',
      },
      {
        id: 'step-closed',
        name: 'Closed',
        type: 'terminal',
      },
    ],
    transitions: [
      { from: 'step-intake', to: 'step-review' },
    ],
    triggers: [
      { type: 'manual', name: 'Start Process' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildProcessInstance
// ---------------------------------------------------------------------------

export function buildProcessInstance(
  overrides?: Partial<ProcessInstance>,
): ProcessInstance {
  const id = nextId('inst');
  return {
    id,
    definitionName: 'supply-chain-review',
    definitionVersion: '1.0',
    status: 'running',
    currentStepId: 'step-intake',
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_UPDATED_TIMESTAMP,
    createdBy: 'user-001',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildStepExecution
// ---------------------------------------------------------------------------

export function buildStepExecution(
  overrides?: Partial<StepExecution>,
): StepExecution {
  const id = nextId('exec');
  return {
    id,
    instanceId: 'inst-0001',
    stepId: 'step-intake',
    status: 'completed',
    input: { supplierId: 'supplier-001' },
    output: { result: 'ok' },
    verdict: null,
    executedBy: 'user-001',
    startedAt: DEFAULT_TIMESTAMP,
    completedAt: DEFAULT_UPDATED_TIMESTAMP,
    iterationNumber: 0,
    gateResult: null,
    error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildHumanTask
// ---------------------------------------------------------------------------

export function buildHumanTask(
  overrides?: Partial<HumanTask>,
): HumanTask {
  const id = nextId('task');
  return {
    id,
    processInstanceId: 'inst-0001',
    stepId: 'step-review',
    assignedRole: 'reviewer',
    assignedUserId: null,
    status: 'pending',
    deadline: null,
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_UPDATED_TIMESTAMP,
    completedAt: null,
    completionData: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAgentOutputEnvelope
// ---------------------------------------------------------------------------

export function buildAgentOutputEnvelope(
  overrides?: Partial<AgentOutputEnvelope>,
): AgentOutputEnvelope {
  return {
    confidence: 0.92,
    confidence_rationale: 'Standard analysis with complete input data. All compliance checks passed with no anomalies — expected error rate below 1 in 10.',
    reasoning_summary: 'Analysis completed successfully',
    reasoning_chain: [
      'Loaded supplier data',
      'Ran compliance checks',
      'Generated report',
    ],
    annotations: [
      {
        id: 'ann-0001',
        content: 'No discrepancies detected',
        timestamp: DEFAULT_TIMESTAMP,
      },
    ],
    model: 'anthropic/claude-sonnet-4',
    duration_ms: 1500,
    result: { flagged: false, score: 0.92 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAgentRun
// ---------------------------------------------------------------------------

export function buildAgentRun(
  overrides?: Partial<AgentRun>,
): AgentRun {
  const id = nextId('run');
  return {
    id,
    processInstanceId: 'inst-0001',
    stepId: 'step-analyze',
    pluginId: '@mediforce/example-agent',
    autonomyLevel: 'L2',
    status: 'completed',
    envelope: buildAgentOutputEnvelope(),
    fallbackReason: null,
    startedAt: DEFAULT_TIMESTAMP,
    completedAt: DEFAULT_UPDATED_TIMESTAMP,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAuditEvent
// ---------------------------------------------------------------------------

export function buildAuditEvent(
  overrides?: Partial<AuditEvent>,
): AuditEvent {
  return {
    actorId: 'user-001',
    actorType: 'user',
    actorRole: 'reviewer',
    action: 'step.completed',
    description: 'Completed the intake step',
    timestamp: DEFAULT_TIMESTAMP,
    inputSnapshot: { supplierId: 'supplier-001' },
    outputSnapshot: { result: 'ok' },
    basis: 'manual review',
    entityType: 'step-execution',
    entityId: 'exec-0001',
    processInstanceId: 'inst-0001',
    stepId: 'step-intake',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildFileMetadata
// ---------------------------------------------------------------------------

export function buildFileMetadata(
  overrides?: Partial<FileMetadata>,
): FileMetadata {
  const id = nextId('file');
  return {
    id,
    name: `document-${id}.pdf`,
    size: 102400,
    type: 'application/pdf',
    storagePath: `uploads/test/${id}.pdf`,
    uploadedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildProcessConfig
// ---------------------------------------------------------------------------

export function buildProcessConfig(
  overrides?: Partial<ProcessConfig>,
): ProcessConfig {
  return {
    processName: 'supply-chain-review',
    configName: 'default',
    configVersion: '1.0',
    stepConfigs: [
      {
        stepId: 'step-intake',
        executorType: 'agent' as const,
        plugin: '@mediforce/intake-agent',
        autonomyLevel: 'L2' as const,
        confidenceThreshold: 0.8,
        fallbackBehavior: 'escalate_to_human' as const,
        timeoutMinutes: 30,
      },
      {
        stepId: 'step-review',
        executorType: 'human' as const,
        allowedRoles: ['reviewer', 'approver'],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildWorkflowDefinition
// ---------------------------------------------------------------------------

export function buildWorkflowDefinition(
  overrides?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    name: 'test-workflow',
    version: 1,
    namespace: 'test',
    steps: [
      {
        id: 'intake',
        name: 'Intake',
        type: 'creation',
        executor: 'human',
      },
      {
        id: 'review',
        name: 'Review',
        type: 'review',
        executor: 'agent',
        autonomyLevel: 'L2',
      },
      {
        id: 'complete',
        name: 'Complete',
        type: 'terminal',
        executor: 'human',
      },
    ],
    transitions: [
      { from: 'intake', to: 'review' },
      { from: 'review', to: 'complete' },
    ],
    triggers: [
      { type: 'manual', name: 'Start' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCoworkSession
// ---------------------------------------------------------------------------

export function buildCoworkSession(
  overrides?: Partial<CoworkSession>,
): CoworkSession {
  const id = nextId('session');
  return {
    id,
    processInstanceId: 'inst-0001',
    stepId: 'step-cowork',
    assignedRole: 'analyst',
    assignedUserId: null,
    status: 'active',
    agent: 'chat',
    model: null,
    systemPrompt: null,
    outputSchema: null,
    voiceConfig: null,
    artifact: null,
    mcpServers: null,
    turns: [],
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_UPDATED_TIMESTAMP,
    finalizedAt: null,
    ...overrides,
  };
}
