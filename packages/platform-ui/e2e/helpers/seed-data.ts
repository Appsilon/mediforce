const now = new Date().toISOString();
const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
const nextWeek = new Date(Date.now() + 7 * 86400_000).toISOString();

export interface SeedOptions {
  /** Base URL of the mock OAuth server (from globalSetup). Used to build the
   *  `github-mock` provider fixture so the journey can Connect through it
   *  without touching real GitHub/Google. */
  mockOAuthBaseUrl?: string;
}

export function buildSeedData(testUserId: string, options: SeedOptions = {}) {
  const mockOAuthBaseUrl = options.mockOAuthBaseUrl ?? 'http://127.0.0.1:0';
  const humanTasks: Record<string, Record<string, unknown>> = {
    'task-pending-1': {
      id: 'task-pending-1',
      processInstanceId: 'proc-running-1',
      stepId: 'review-intake-data',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: nextWeek,
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
      completedAt: null,
      completionData: null,
    },
    'task-claimed-1': {
      id: 'task-claimed-1',
      processInstanceId: 'proc-running-1',
      stepId: 'approve-report',
      assignedRole: 'reviewer',
      assignedUserId: testUserId,
      status: 'claimed',
      deadline: nextWeek,
      createdAt: oneHourAgo,
      updatedAt: now,
      completedAt: null,
      completionData: null,
    },
    'task-completed-1': {
      id: 'task-completed-1',
      processInstanceId: 'proc-completed-1',
      stepId: 'verify-data-quality',
      assignedRole: 'reviewer',
      assignedUserId: testUserId,
      status: 'completed',
      deadline: null,
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
      completionData: { approved: true, notes: 'All checks passed' },
    },
    'task-pending-2': {
      id: 'task-pending-2',
      processInstanceId: 'proc-paused-1',
      stepId: 'assess-supplier-risk',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'pending',
      deadline: nextWeek,
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
      completedAt: null,
      completionData: null,
    },
    'task-human-review': {
      id: 'task-human-review',
      processInstanceId: 'proc-human-waiting',
      stepId: 'human-review',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: nextWeek,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completionData: null,
    },
    // Dedicated task for task-review.journey.ts — approving this advances
    // proc-review-target, not proc-human-waiting, so the status-badges test
    // is not polluted by the approval flow.
    'task-review-target': {
      id: 'task-review-target',
      processInstanceId: 'proc-review-target',
      stepId: 'human-review',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: nextWeek,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completionData: null,
    },
    'task-upload-docs': {
      id: 'task-upload-docs',
      processInstanceId: 'proc-upload-waiting',
      stepId: 'upload-documents',
      assignedRole: 'operator',
      assignedUserId: testUserId,
      status: 'claimed',
      deadline: nextWeek,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completionData: null,
      ui: {
        component: 'file-upload',
        config: {
          acceptedTypes: ['application/pdf'],
          minFiles: 1,
          maxFiles: 5,
        },
      },
    },
  };

  const processInstances: Record<string, Record<string, unknown>> = {
    'proc-running-1': {
      id: 'proc-running-1',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'running',
      currentStepId: 'narrative-summary',
      variables: { studyId: 'study-001', cycle: 3 },
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: ['reviewer'],
    },
    // Dedicated instance for cancel-run test — isolated so cancelling doesn't affect other tests
    'proc-cancel-target': {
      id: 'proc-cancel-target',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'running',
      currentStepId: 'narrative-summary',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: ['reviewer'],
    },
    'proc-paused-1': {
      id: 'proc-paused-1',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'paused',
      currentStepId: 'data-quality-check',
      variables: { studyId: 'study-002' },
      triggerType: 'webhook',
      triggerPayload: { source: 'edc-system' },
      createdAt: twoDaysAgo,
      updatedAt: oneHourAgo,
      createdBy: 'webhook',
      pauseReason: 'agent_escalated',
      error: null,
      assignedRoles: ['analyst', 'reviewer'],
    },
    'proc-completed-1': {
      id: 'proc-completed-1',
      definitionName: 'Data Quality Review',
      definitionVersion: '2.1.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'completed',
      currentStepId: null,
      variables: { studyId: 'study-001' },
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      createdBy: testUserId,
      pauseReason: null,
      error: null,
      assignedRoles: ['reviewer'],
    },
    'proc-failed-1': {
      id: 'proc-failed-1',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'failed',
      currentStepId: 'compliance-check',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: threeDaysAgo,
      createdBy: 'system',
      pauseReason: null,
      error: 'Agent timeout after 30s',
      assignedRoles: [],
    },
    'proc-completed-2': {
      id: 'proc-completed-2',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'completed',
      currentStepId: null,
      variables: { studyId: 'study-004' },
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      createdBy: testUserId,
      pauseReason: null,
      error: null,
      assignedRoles: ['reviewer'],
    },
    'proc-human-waiting': {
      id: 'proc-human-waiting',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'paused',
      currentStepId: 'human-review',
      variables: { studyId: 'study-003' },
      triggerType: 'manual',
      triggerPayload: { studyId: 'study-003' },
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: 'auto-runner',
      pauseReason: 'waiting_for_human',
      error: null,
      assignedRoles: ['reviewer'],
    },
    // Dedicated instance for task-review.journey.ts — isolated so approving its
    // task does not pollute the proc-human-waiting used by workflow-status-badges.
    'proc-review-target': {
      id: 'proc-review-target',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'paused',
      currentStepId: 'human-review',
      variables: { studyId: 'study-review-target' },
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: 'auto-runner',
      pauseReason: 'waiting_for_human',
      error: null,
      assignedRoles: ['reviewer'],
    },
    // New-style run — uses WorkflowDefinition (no configName/configVersion)
    'proc-workflow-run-1': {
      id: 'proc-workflow-run-1',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1',
      status: 'running',
      currentStepId: 'narrative-summary',
      variables: { studyId: 'study-wf-001' },
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: testUserId,
      pauseReason: null,
      error: null,
      assignedRoles: ['reviewer'],
    },
    'proc-upload-waiting': {
      id: 'proc-upload-waiting',
      definitionName: 'Protocol to TFL',
      definitionVersion: '0.1.0',
      configName: 'default',
      configVersion: '1',
      status: 'paused',
      currentStepId: 'upload-documents',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: now,
      updatedAt: now,
      createdBy: testUserId,
      pauseReason: 'waiting_for_human',
      error: null,
      assignedRoles: ['operator'],
    },
    // Dedicated instance for workflow-status-badges test — paused with step_failure
    // so the Error badge, error banner with reason text, and "Run again this step"
    // button are all visible without triggering any actual retry.
    'proc-step-failure': {
      id: 'proc-step-failure',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1',
      status: 'paused',
      currentStepId: 'human-review',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: testUserId,
      pauseReason: 'step_failure',
      error: 'Docker container exited with code 1',
      assignedRoles: ['reviewer'],
    },
    // Dedicated instance for retry-step test — agent escalated on the human-review
    // step so AgentEscalatedBanner is shown with "Fixed, try again". Clicking it
    // calls engine.retryStep (paused+agent_escalated is in the allowed list), which
    // flips status→running; the auto-runner then creates a HumanTask and pauses
    // with waiting_for_human. No plugin or Docker involved.
    'proc-retry-test': {
      id: 'proc-retry-test',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1',
      status: 'paused',
      currentStepId: 'human-review',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: threeDaysAgo,
      createdBy: testUserId,
      pauseReason: 'agent_escalated',
      error: 'Simulated step failure for retry journey',
      assignedRoles: ['reviewer'],
    },
    // Dedicated instance for cancel flow test — isolated from proc-retry-test so
    // cancelling does not pollute the retry journey.
    'proc-agent-escalated-cancel': {
      id: 'proc-agent-escalated-cancel',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1',
      status: 'paused',
      currentStepId: 'human-review',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: now,
      createdBy: testUserId,
      pauseReason: 'agent_escalated',
      error: 'API rate limit exceeded — retried 3 times',
      assignedRoles: ['reviewer'],
    },
  };

  const agentRuns: Record<string, Record<string, unknown>> = {
    'run-completed-1': {
      id: 'run-completed-1',
      processInstanceId: 'proc-running-1',
      stepId: 'narrative-summary',
      pluginId: 'narrative-summary',
      autonomyLevel: 'L2',
      status: 'completed',
      envelope: {
        model: 'openrouter/anthropic/claude-sonnet-4',
        confidence: 0.92,
        confidence_rationale: 'Routine review of 12 well-structured vendor submissions. All fields present, no ambiguities. Expected error rate below 1 in 10.',
        reasoning_summary: 'Reviewed 12 vendor submissions. No issues detected. All items within expected parameters.',
        reasoning_chain: [],
        duration_ms: 1200,
        result: { issuesFound: 0, reviewedItems: 12, recommendation: 'continue' },
        annotations: [],
      },
      fallbackReason: null,
      startedAt: oneHourAgo,
      completedAt: now,
      executorType: 'agent',
      reviewerType: 'none',
    },
    'run-escalated-1': {
      id: 'run-escalated-1',
      processInstanceId: 'proc-paused-1',
      stepId: 'data-quality-check',
      pluginId: 'data-quality',
      autonomyLevel: 'L3',
      status: 'escalated',
      envelope: {
        model: 'openrouter/anthropic/claude-sonnet-4',
        confidence: 0.45,
        confidence_rationale: 'Multiple data inconsistencies in lab values — 3 out of 7 fields required interpolation from incomplete source data. In ~6/10 similar cases, at least one critical issue would be missed.',
        reasoning_summary: 'Multiple data inconsistencies found in lab values. Requires human review.',
        reasoning_chain: [],
        duration_ms: 3500,
        result: { issuesFound: 7, criticalIssues: 2 },
        annotations: [],
      },
      fallbackReason: 'low_confidence',
      startedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
      executorType: 'agent',
      reviewerType: 'human',
    },
    'run-running-1': {
      id: 'run-running-1',
      processInstanceId: 'proc-running-1',
      stepId: 'compliance-check',
      pluginId: 'compliance-check',
      autonomyLevel: 'L1',
      status: 'running',
      envelope: null,
      fallbackReason: null,
      startedAt: now,
      completedAt: null,
      executorType: 'agent',
    },
    'run-l4-autopilot': {
      id: 'run-l4-autopilot',
      processInstanceId: 'proc-completed-2',
      stepId: 'vendor-assessment',
      pluginId: 'vendor-assessment',
      autonomyLevel: 'L4',
      status: 'completed',
      envelope: {
        model: 'openrouter/anthropic/claude-sonnet-4',
        confidence: 0.97,
        confidence_rationale: 'Standard vendor assessment with complete metrics. All values within established norms. Fewer than 3 in 100 similar cases would surface an issue.',
        reasoning_summary: 'All metrics within expected range. Auto-approved.',
        reasoning_chain: [],
        duration_ms: 800,
        result: { issuesFound: 0, autoApproved: true },
        annotations: [],
      },
      fallbackReason: null,
      startedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
      executorType: 'agent',
      reviewerType: 'none',
    },
  };

  const auditEvents: Record<string, Record<string, unknown>> = {
    'audit-1': {
      actorId: 'agent:narrative-summary',
      actorType: 'agent',
      actorRole: 'agent',
      action: 'step.started',
      description: 'Agent started narrative summary step',
      timestamp: oneHourAgo,
      inputSnapshot: { stepId: 'narrative-summary' },
      outputSnapshot: {},
      basis: 'process-definition',
      entityType: 'step-execution',
      entityId: 'exec-1',
      processInstanceId: 'proc-running-1',
      stepId: 'narrative-summary',
      processDefinitionVersion: '1.0.0',
    },
    'audit-2': {
      actorId: 'agent:narrative-summary',
      actorType: 'agent',
      actorRole: 'agent',
      action: 'step.completed',
      description: 'Agent completed narrative summary with confidence 0.92',
      timestamp: now,
      inputSnapshot: { stepId: 'narrative-summary' },
      outputSnapshot: { confidence: 0.92, issuesFound: 0 },
      basis: 'agent-output',
      entityType: 'step-execution',
      entityId: 'exec-1',
      processInstanceId: 'proc-running-1',
      stepId: 'narrative-summary',
      processDefinitionVersion: '1.0.0',
    },
    'audit-3': {
      actorId: 'system',
      actorType: 'system',
      actorRole: 'system',
      action: 'process.completed',
      description: 'Process completed successfully',
      timestamp: twoDaysAgo,
      inputSnapshot: {},
      outputSnapshot: { finalStatus: 'completed' },
      basis: 'workflow-engine',
      entityType: 'process-instance',
      entityId: 'proc-completed-1',
      processInstanceId: 'proc-completed-1',
      processDefinitionVersion: '2.1.0',
    },
  };

  const stepExecutions: Record<string, Record<string, unknown>> = {
    'exec-intake': {
      id: 'exec-intake',
      instanceId: 'proc-running-1',
      stepId: 'vendor-assessment',
      status: 'completed',
      input: { source: 'edc-import' },
      output: { participantsLoaded: 24 },
      verdict: null,
      executedBy: 'system',
      startedAt: oneHourAgo,
      completedAt: oneHourAgo,
      iterationNumber: 0,
      gateResult: { next: 'narrative-summary', reason: 'intake complete' },
      error: null,
    },
    'exec-intake-review': {
      id: 'exec-intake-review',
      instanceId: 'proc-running-1',
      stepId: 'narrative-summary',
      status: 'running',
      input: { participantIds: ['p-001', 'p-002', 'p-003'] },
      output: null,
      verdict: null,
      executedBy: 'agent:intake-review',
      startedAt: now,
      completedAt: null,
      iterationNumber: 0,
      gateResult: null,
      error: null,
    },
  };

  const stepFailureStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-step-failure-1': {
      id: 'exec-step-failure-1',
      instanceId: 'proc-step-failure',
      stepId: 'human-review',
      status: 'failed',
      input: {},
      output: null,
      verdict: null,
      executedBy: 'agent:script-container',
      startedAt: oneHourAgo,
      completedAt: now,
      iterationNumber: 0,
      gateResult: null,
      error: 'Docker container exited with code 1',
    },
  };

  const retryTestStepExecutions: Record<string, Record<string, unknown>> = {
    // Seed a single failed execution so retryStep's latestExecution guard is satisfied
    'exec-retry-fail-1': {
      id: 'exec-retry-fail-1',
      instanceId: 'proc-retry-test',
      stepId: 'human-review',
      status: 'failed',
      input: {},
      output: null,
      verdict: null,
      executedBy: 'auto-runner',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: null,
      error: 'Simulated step failure for retry journey',
    },
  };

  const agentEscalatedCancelStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-cancel-fail-1': {
      id: 'exec-cancel-fail-1',
      instanceId: 'proc-agent-escalated-cancel',
      stepId: 'human-review',
      status: 'failed',
      input: {},
      output: null,
      verdict: null,
      executedBy: 'auto-runner',
      startedAt: oneHourAgo,
      completedAt: oneHourAgo,
      iterationNumber: 0,
      gateResult: null,
      error: 'API rate limit exceeded — retried 3 times',
    },
  };

  const humanWaitingStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-hw-agent-1': {
      id: 'exec-hw-agent-1',
      instanceId: 'proc-human-waiting',
      stepId: 'query-status',
      status: 'completed',
      input: { studyId: 'study-003' },
      output: {
        reasoning_summary: 'Analyzed 15 open queries across 3 sites. 4 queries are overdue, 2 critical.',
        queriesTotal: 15,
        queriesOverdue: 4,
        queriesCritical: 2,
        sites: ['Site A', 'Site B', 'Site C'],
        recommendation: 'Review overdue queries — 2 critical queries require immediate attention',
      },
      verdict: null,
      executedBy: 'agent:query-status',
      startedAt: oneHourAgo,
      completedAt: now,
      iterationNumber: 0,
      gateResult: { next: 'human-review', reason: 'agent step complete' },
      error: null,
    },
  };

  // Step executions for the dedicated task-review journey instance.
  // Mirrors humanWaitingStepExecutions so the "previous step output" tab
  // shows content, but is isolated under proc-review-target.
  const reviewTargetStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-review-target-1': {
      id: 'exec-review-target-1',
      instanceId: 'proc-review-target',
      stepId: 'query-status',
      status: 'completed',
      input: { studyId: 'study-review-target' },
      output: {
        reasoning_summary: 'Analyzed 10 open queries across 2 sites. 2 queries are overdue.',
        queriesTotal: 10,
        queriesOverdue: 2,
        queriesCritical: 1,
        sites: ['Site A', 'Site B'],
        recommendation: 'Review overdue queries — 1 critical query requires attention',
      },
      verdict: null,
      executedBy: 'agent:query-status',
      startedAt: oneHourAgo,
      completedAt: now,
      iterationNumber: 0,
      gateResult: { next: 'human-review', reason: 'agent step complete' },
      error: null,
    },
  };

  const processDefinitions: Record<string, Record<string, unknown>> = {
    'def-supply-chain-review': {
      name: 'Supply Chain Review',
      namespace: 'test',
      version: '1.0.0',
      description: 'End-to-end supply chain review process',
      steps: [
        { id: 'vendor-assessment', name: 'Vendor Assessment', type: 'creation' },
        { id: 'narrative-summary', name: 'Narrative Summary', type: 'creation' },
        { id: 'risk-scoring', name: 'Risk Scoring', type: 'creation' },
        { id: 'data-quality', name: 'Data Quality Analysis', type: 'creation' },
        { id: 'query-status', name: 'Query Status Analysis', type: 'creation' },
        { id: 'human-review', name: 'Human Review', type: 'creation' },
        { id: 'manager-approval', name: 'Manager Approval', type: 'review', verdicts: { approve: { target: 'archived' }, revise: { target: 'archived' } } },
        { id: 'archived', name: 'Archived', type: 'terminal' },
      ],
      transitions: [
        { from: 'vendor-assessment', to: 'narrative-summary' },
        { from: 'narrative-summary', to: 'risk-scoring' },
        { from: 'risk-scoring', to: 'data-quality' },
        { from: 'data-quality', to: 'query-status' },
        { from: 'query-status', to: 'human-review' },
        { from: 'human-review', to: 'manager-approval' },
        { from: 'manager-approval', to: 'archived' },
      ],
      triggers: [{ type: 'manual', name: 'start-review-cycle' }],
    },
    'def-data-quality-review': {
      name: 'Data Quality Review',
      namespace: 'test',
      version: '2.1.0',
      description: 'Data quality check workflow',
      steps: [
        { id: 'verify-data-quality', name: 'Verify Data Quality', type: 'creation' },
        { id: 'review-results', name: 'Review Results', type: 'creation' },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'verify-data-quality', to: 'review-results' },
        { from: 'review-results', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'start-review' }],
    },
  };

  const completedProcessStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-dq-verify': {
      id: 'exec-dq-verify',
      instanceId: 'proc-completed-1',
      stepId: 'verify-data-quality',
      status: 'completed',
      input: { studyId: 'study-001' },
      output: { issuesFound: 0, allChecksPass: true },
      verdict: null,
      executedBy: 'agent:data-quality',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'review-results', reason: 'quality check complete' },
      error: null,
    },
    'exec-dq-review': {
      id: 'exec-dq-review',
      instanceId: 'proc-completed-1',
      stepId: 'review-results',
      status: 'completed',
      input: { issuesFound: 0 },
      output: { approved: true, notes: 'All checks passed' },
      verdict: null,
      executedBy: 'test-user',
      startedAt: threeDaysAgo,
      completedAt: twoDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'done', reason: 'review complete' },
      error: null,
    },
  };

  const completedSupplyChainStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-cm-spp': {
      id: 'exec-cm-spp',
      instanceId: 'proc-completed-2',
      stepId: 'vendor-assessment',
      status: 'completed',
      input: { studyId: 'study-004' },
      output: { participantsReviewed: 18 },
      verdict: null,
      executedBy: 'agent:vendor-assessment',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'narrative-summary', reason: 'vendor assessment complete' },
      error: null,
    },
    'exec-cm-ns': {
      id: 'exec-cm-ns',
      instanceId: 'proc-completed-2',
      stepId: 'narrative-summary',
      status: 'completed',
      input: { participantsReviewed: 18 },
      output: { summaryGenerated: true },
      verdict: null,
      executedBy: 'agent:narrative-summary',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'risk-scoring', reason: 'narrative complete' },
      error: null,
    },
    'exec-cm-spa': {
      id: 'exec-cm-spa',
      instanceId: 'proc-completed-2',
      stepId: 'risk-scoring',
      status: 'completed',
      input: { summaryGenerated: true },
      output: { populationSafe: true },
      verdict: null,
      executedBy: 'agent:risk-scoring',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'data-quality', reason: 'population analysis complete' },
      error: null,
    },
    'exec-cm-dq': {
      id: 'exec-cm-dq',
      instanceId: 'proc-completed-2',
      stepId: 'data-quality',
      status: 'completed',
      input: { populationSafe: true },
      output: { issuesFound: 0 },
      verdict: null,
      executedBy: 'agent:data-quality',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'query-status', reason: 'data quality check complete' },
      error: null,
    },
    'exec-cm-qs': {
      id: 'exec-cm-qs',
      instanceId: 'proc-completed-2',
      stepId: 'query-status',
      status: 'completed',
      input: { issuesFound: 0 },
      output: { openQueries: 0 },
      verdict: null,
      executedBy: 'agent:query-status',
      startedAt: threeDaysAgo,
      completedAt: threeDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'human-review', reason: 'query status complete' },
      error: null,
    },
    'exec-cm-hr': {
      id: 'exec-cm-hr',
      instanceId: 'proc-completed-2',
      stepId: 'human-review',
      status: 'completed',
      input: { openQueries: 0 },
      output: { reviewed: true },
      verdict: null,
      executedBy: testUserId,
      startedAt: threeDaysAgo,
      completedAt: twoDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'manager-approval', reason: 'human review complete' },
      error: null,
    },
    'exec-cm-ma': {
      id: 'exec-cm-ma',
      instanceId: 'proc-completed-2',
      stepId: 'manager-approval',
      status: 'completed',
      input: { reviewed: true },
      output: { verdict: 'approve', comment: 'All looks good' },
      verdict: 'approve',
      executedBy: testUserId,
      startedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
      iterationNumber: 0,
      gateResult: { next: 'archived', reason: 'Approved by manager' },
      error: null,
    },
  };

  const processConfigs: Record<string, Record<string, unknown>> = {
    'Supply Chain Review:all-human:1': {
      processName: 'Supply Chain Review',
      configName: 'all-human',
      configVersion: '1',
      stepConfigs: [
        { stepId: 'vendor-assessment', executorType: 'agent', autonomyLevel: 'L4', plugin: 'supply-chain/vendor-assessment' },
        { stepId: 'narrative-summary', executorType: 'agent', autonomyLevel: 'L2', plugin: 'supply-chain/narrative-summary' },
        { stepId: 'risk-scoring', executorType: 'agent', autonomyLevel: 'L3', plugin: 'supply-chain/risk-scoring', reviewerType: 'human' },
        { stepId: 'data-quality', executorType: 'agent', autonomyLevel: 'L2', plugin: 'supply-chain/data-quality' },
        { stepId: 'query-status', executorType: 'agent', autonomyLevel: 'L1', plugin: 'supply-chain/query-status' },
        { stepId: 'human-review', executorType: 'human' },
        { stepId: 'manager-approval', executorType: 'human' },
      ],
    },
  };

  // User profile document — required by Firestore security rules.
  // humanTasks and handoffEntities rules call get(/users/{uid}).data.roles
  // to verify the reader has a matching role.
  const users: Record<string, Record<string, unknown>> = {
    [testUserId]: {
      uid: testUserId,
      email: 'test@mediforce.dev',
      displayName: 'Test User',
      handle: 'test',
      organizations: [],
      role: 'admin',
      roles: ['reviewer', 'analyst', 'operator'],
    },
  };

  const workflowDefinitions: Record<string, Record<string, unknown>> = {
    // Example workflow that exercises the run-scoped git workspace with a
    // small real-shaped data pipeline: step 1 generates a CSV dataset, step 2
    // reads it, computes summary stats, and writes a markdown report into a
    // different subdirectory. A manual run leaves a run/<id> branch in the
    // local bare repo with:
    //
    //   <seed>          "workspace initialized" (.gitignore seed)
    //   generate-data   adds data/sales.csv
    //   summarize       adds report/summary.md
    //
    // You can `git log`, `git diff`, and inspect the per-step artifacts.
    'Sales CSV Report:1': {
      name: 'Sales CSV Report',
      namespace: 'test',
      version: 1,
      title: 'Sales CSV → summary report',
      description: 'Two-step pipeline: generate a small sales CSV, then summarise it into a markdown report. Each step commits its artefacts to the run branch.',
      workspace: {},
      steps: [
        {
          id: 'generate-data',
          name: 'Generate sales.csv',
          type: 'creation',
          executor: 'script',
          plugin: 'script-container',
          autonomyLevel: 'L4',
          agent: {
            runtime: 'bash',
            inlineScript: [
              '#!/bin/sh',
              'set -eu',
              'mkdir -p /workspace/data',
              "printf 'region,units,revenue\\nnorth,12,2400\\nsouth,8,1600\\neast,17,3825\\nwest,5,900\\n' > /workspace/data/sales.csv",
              'printf \'{"ok":true,"rows":4}\' > /output/result.json',
              '',
            ].join('\n'),
          },
        },
        {
          id: 'summarize',
          name: 'Summarise → report/summary.md',
          type: 'creation',
          executor: 'script',
          plugin: 'script-container',
          autonomyLevel: 'L4',
          agent: {
            runtime: 'bash',
            inlineScript: [
              '#!/bin/sh',
              'set -eu',
              'test -f /workspace/data/sales.csv',
              'mkdir -p /workspace/report',
              'cd /workspace',
              "ROWS=$(tail -n +2 data/sales.csv | wc -l | tr -d ' ')",
              "TOTAL=$(tail -n +2 data/sales.csv | awk -F, '{s+=$3} END{print s}')",
              "TOP=$(tail -n +2 data/sales.csv | sort -t, -k3 -nr | head -1 | cut -d, -f1)",
              '{',
              "  echo '# Sales summary'",
              '  echo',
              "  echo '| metric | value |'",
              "  echo '|---|---|'",
              '  echo "| rows | $ROWS |"',
              '  echo "| total revenue | $TOTAL |"',
              '  echo "| top region | $TOP |"',
              '} > report/summary.md',
              'printf \'{"ok":true}\' > /output/result.json',
              '',
            ].join('\n'),
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'generate-data', to: 'summarize' },
        { from: 'summarize', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'start' }],
      createdAt: twoDaysAgo,
    },
    'Supply Chain Review:1': {
      name: 'Supply Chain Review',
      namespace: 'test',
      version: 1,
      title: 'Initial vendor assessment workflow',
      description: 'End-to-end supply chain review process',
      steps: [
        { id: 'vendor-assessment', name: 'Vendor Assessment', type: 'creation', executor: 'agent', autonomyLevel: 'L2', plugin: 'supply-data-collector', agent: { skill: 'vendor-assessment', mcpServers: [{ name: 'postgres-ro', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { DATABASE_URL: '{{DB_URL}}' }, allowedTools: ['query'] }, { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'] }] } },
        { id: 'narrative-summary', name: 'Narrative Summary', type: 'creation', executor: 'agent', autonomyLevel: 'L3' },
        { id: 'risk-scoring', name: 'Risk Scoring', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'data-quality', name: 'Data Quality Analysis', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'query-status', name: 'Query Status Analysis', type: 'creation', executor: 'agent', autonomyLevel: 'L1' },
        { id: 'human-review', name: 'Human Review', type: 'creation', executor: 'human' },
        { id: 'manager-approval', name: 'Manager Approval', type: 'review', executor: 'human', verdicts: { approve: { target: 'archived' }, revise: { target: 'archived' } } },
        { id: 'archived', name: 'Archived', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'vendor-assessment', to: 'narrative-summary' },
        { from: 'narrative-summary', to: 'risk-scoring' },
        { from: 'risk-scoring', to: 'data-quality' },
        { from: 'data-quality', to: 'query-status' },
        { from: 'query-status', to: 'human-review' },
        { from: 'human-review', to: 'manager-approval' },
        { from: 'manager-approval', to: 'archived' },
      ],
      triggers: [{ type: 'manual', name: 'start-review-cycle' }],
      createdAt: twoDaysAgo,
    },
    'Data Quality Review:2': {
      name: 'Data Quality Review',
      namespace: 'test',
      version: 2,
      title: 'Data quality check',
      description: 'Data quality check workflow',
      steps: [
        { id: 'verify-data-quality', name: 'Verify Data Quality', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'review-results', name: 'Review Results', type: 'creation', executor: 'human' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'verify-data-quality', to: 'review-results' },
        { from: 'review-results', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'start-review' }],
      createdAt: threeDaysAgo,
    },
  };

  const namespaces: Record<string, Record<string, unknown>> = {
    test: {
      id: 'test',
      handle: 'test',
      type: 'personal',
      displayName: 'Test User',
      linkedUserId: testUserId,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  };

  const namespaceMembers: Record<string, Record<string, unknown>> = {
    [testUserId]: {
      id: testUserId,
      uid: testUserId,
      role: 'owner',
      joinedAt: '2024-01-01T00:00:00.000Z',
    },
  };

  // Namespace-scoped tool catalog — seed entries under
  // `namespaces/{TEST_ORG_HANDLE}/toolCatalog/{entryId}`. Doc id IS the entry id,
  // so we strip `id` from the payload to match FirestoreToolCatalogRepository
  // (see packages/platform-infra/src/firestore/tool-catalog-repository.ts).
  const toolCatalog: Record<string, Record<string, unknown>> = {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
      description: 'Read and write files in a scoped directory.',
    },
    postgres: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: { DATABASE_URL: '{{SECRET:DATABASE_URL}}' },
      description: 'Execute read-only SQL queries against a PostgreSQL database.',
    },
  };

  // Top-level agentDefinitions collection — pre-seed `claude-code-agent` so the
  // agent MCP journey is deterministic. Without this, the page relies on the
  // fire-and-forget `seedBuiltinAgentDefinitions` in platform-services, which
  // races with the first GET `/api/agent-definitions/:id` request.
  //
  // `mcp-test-agent` is a fixture consumed by step-mcp-restrictions.journey.ts —
  // it ships with one pre-bound stdio server so the Restrictions section has
  // something to narrow. Journey 2 uses `claude-code-agent`, which must start
  // binding-free for its "empty state" assertion; hence the split.
  const agentDefinitions: Record<string, Record<string, unknown>> = {
    'claude-code-agent': {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Claude Code Agent',
      iconName: 'Bot',
      description:
        "Executes code generation, analysis, and automated software tasks using Claude's advanced coding capabilities.",
      inputDescription: 'Task description and relevant code context',
      outputDescription: 'Generated code, analysis results, or task completion report',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: '',
      skillFileNames: [],
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    },
    'mcp-test-agent': {
      kind: 'plugin',
      runtimeId: 'script-container',
      name: 'MCP Test Agent',
      iconName: 'Terminal',
      description: 'Fixture agent for step-level MCP restrictions journey.',
      inputDescription: 'test input',
      outputDescription: 'test output',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: '',
      skillFileNames: [],
      mcpServers: {
        filesystem: { type: 'stdio', catalogId: 'filesystem' },
      },
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    },
    // Fixture agent for the OAuth journey (Step 5). Ships with a pre-bound
    // HTTP binding named `github-mcp` configured for OAuth via the
    // `github-mock` provider, so the journey opens the editor and jumps
    // straight to "Connect" without first editing the agent.
    'oauth-test-agent': {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'OAuth Test Agent',
      iconName: 'Bot',
      description: 'Fixture agent for the per-agent OAuth journey.',
      inputDescription: 'task input',
      outputDescription: 'task output',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: '',
      skillFileNames: [],
      mcpServers: {
        'github-mcp': {
          type: 'http',
          url: 'https://api.example.com/mcp',
          auth: {
            type: 'oauth',
            provider: 'github-mock',
            headerName: 'Authorization',
            headerValueTemplate: 'Bearer {token}',
          },
        },
      },
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    },
  };

  // ── OAuth providers (Step 5) ───────────────────────────────────────────────
  // Seeded into `namespaces/{TEST_ORG_HANDLE}/oauthProviders/{providerId}`.
  // The mock OAuth server started in globalSetup exposes /authorize, /token,
  // /userinfo, /revoke — we point the provider at it so Connect / Disconnect /
  // Revoke flow end-to-end without any real external dependency.
  const oauthProviders: Record<string, Record<string, unknown>> = {
    'github-mock': {
      name: 'GitHub (mock)',
      clientId: 'mock-client-id',
      clientSecret: 'mock-client-secret',
      authorizeUrl: `${mockOAuthBaseUrl}/authorize`,
      tokenUrl: `${mockOAuthBaseUrl}/token`,
      userInfoUrl: `${mockOAuthBaseUrl}/userinfo`,
      revokeUrl: `${mockOAuthBaseUrl}/revoke`,
      scopes: ['repo', 'read:user'],
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    },
  };

  // Minimal workflow with one agent step referencing `mcp-test-agent`, used
  // only by step-mcp-restrictions.journey.ts.
  workflowDefinitions['MCP Restrictions Test:1'] = {
    name: 'MCP Restrictions Test',
    namespace: 'test',
    version: 1,
    description: 'Fixture workflow for step-level MCP restrictions journey',
    steps: [
      {
        id: 'process',
        name: 'Process',
        type: 'creation',
        executor: 'agent',
        autonomyLevel: 'L2',
        plugin: 'script-container',
        agentId: 'mcp-test-agent',
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'process', to: 'done' }],
    triggers: [{ type: 'manual', name: 'start' }],
    createdAt: twoDaysAgo,
  };

  // -------------------------------------------------------------------------
  // Cowork sessions — collaborative human+AI artifact building
  // -------------------------------------------------------------------------

  const coworkSessions: Record<string, Record<string, unknown>> = {
    'cowork-active-1': {
      id: 'cowork-active-1',
      processInstanceId: 'proc-cowork-paused',
      stepId: 'design',
      assignedRole: 'analyst',
      assignedUserId: testUserId,
      status: 'active',
      agent: 'chat',
      model: 'anthropic/claude-sonnet-4',
      systemPrompt: 'You are a workflow design assistant.',
      outputSchema: {
        type: 'object',
        required: ['name', 'description', 'steps'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          steps: { type: 'array' },
        },
      },
      voiceConfig: null,
      artifact: {
        name: 'data-quality-review',
        description: 'Automated data quality review workflow',
        steps: [
          { id: 'collect', name: 'Collect Data', executor: 'script' },
          { id: 'analyze', name: 'Analyze Quality', executor: 'agent' },
          { id: 'review', name: 'Human Review', executor: 'human' },
        ],
      },
      turns: [
        {
          id: 'turn-1',
          role: 'human',
          content: 'I need a workflow for automated data quality review with 3 steps: collect data, analyze quality, and human review.',
          timestamp: oneHourAgo,
          artifactDelta: null,
        },
        {
          id: 'turn-2',
          role: 'agent',
          content: 'I\'ve drafted a 3-step workflow: data collection via script, AI-powered quality analysis, and a final human review gate. The artifact has been updated with the full structure.',
          timestamp: oneHourAgo,
          artifactDelta: {
            name: 'data-quality-review',
            description: 'Automated data quality review workflow',
            steps: [
              { id: 'collect', name: 'Collect Data', executor: 'script' },
              { id: 'analyze', name: 'Analyze Quality', executor: 'agent' },
              { id: 'review', name: 'Human Review', executor: 'human' },
            ],
          },
        },
      ],
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
      finalizedAt: null,
    },
  };

  // Process instance paused for cowork
  processInstances['proc-cowork-paused'] = {
    id: 'proc-cowork-paused',
    definitionName: 'Workflow Designer',
    definitionVersion: '1',
    status: 'paused',
    currentStepId: 'design',
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: oneHourAgo,
    updatedAt: oneHourAgo,
    createdBy: testUserId,
    pauseReason: 'cowork_in_progress',
    error: null,
    assignedRoles: ['analyst'],
  };

  // Workflow definition with a cowork step
  workflowDefinitions['Workflow Designer:1'] = {
    name: 'Workflow Designer',
    namespace: 'test',
    version: 1,
    description: 'Collaboratively design workflows with AI',
    steps: [
      {
        id: 'design',
        name: 'Design Workflow',
        type: 'creation',
        executor: 'cowork',
        description: 'Collaboratively build a workflow definition with AI assistance. Describe your requirements and iterate on the design.',
        allowedRoles: ['analyst'],
        cowork: {
          agent: 'chat',
          systemPrompt: 'You are a workflow design assistant.',
          outputSchema: {
            type: 'object',
            required: ['name', 'description', 'steps'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              steps: { type: 'array' },
            },
          },
          chat: { model: 'anthropic/claude-sonnet-4' },
        },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'design', to: 'done' }],
    triggers: [{ type: 'manual', name: 'start-design' }],
    createdAt: twoDaysAgo,
  };

  // Step executions for the new-style workflow run (proc-workflow-run-1)
  // Used by executor identity label tests — vendor-assessment has plugin 'supply-data-collector'
  // in the WorkflowDefinition, so its label should render as 'agent:supply-data-collector'.
  const workflowRunStepExecutions: Record<string, Record<string, unknown>> = {
    'exec-wf-vendor': {
      id: 'exec-wf-vendor',
      instanceId: 'proc-workflow-run-1',
      stepId: 'vendor-assessment',
      status: 'completed',
      input: { studyId: 'study-wf-001' },
      output: { assessed: true },
      verdict: null,
      executedBy: 'agent:vendor-assessment',
      startedAt: oneHourAgo,
      completedAt: oneHourAgo,
      iterationNumber: 0,
      gateResult: { next: 'narrative-summary', reason: 'assessment complete' },
      error: null,
    },
    'exec-wf-narrative': {
      id: 'exec-wf-narrative',
      instanceId: 'proc-workflow-run-1',
      stepId: 'narrative-summary',
      status: 'running',
      input: { assessed: true },
      output: null,
      verdict: null,
      executedBy: 'agent:narrative-summary',
      startedAt: now,
      completedAt: null,
      iterationNumber: 0,
      gateResult: null,
      error: null,
    },
  };

  return { users, humanTasks, processInstances, agentRuns, auditEvents, stepExecutions, humanWaitingStepExecutions, stepFailureStepExecutions, retryTestStepExecutions, agentEscalatedCancelStepExecutions, reviewTargetStepExecutions, processDefinitions, completedProcessStepExecutions, completedSupplyChainStepExecutions, processConfigs, workflowDefinitions, namespaces, namespaceMembers, coworkSessions, toolCatalog, oauthProviders, agentDefinitions, workflowRunStepExecutions };
}
