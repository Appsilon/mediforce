// Fixed UUID literals for seeded agent_runs. `agent_runs.id` is a Postgres
// `uuid` column, so the seed ids must be valid uuids (not readable slugs) or the
// route's `eq(agentRuns.id, ...)` lookup raises `invalid input syntax for type
// uuid`. Deterministic v4-shaped uuids keep the seed reproducible.
export const RUN_COMPLETED_1_ID = '00000000-0000-4000-8000-000000000001';
export const RUN_ESCALATED_1_ID = '00000000-0000-4000-8000-000000000002';
export const RUN_RUNNING_1_ID = '00000000-0000-4000-8000-000000000003';
export const RUN_L4_AUTOPILOT_ID = '00000000-0000-4000-8000-000000000004';
export const RUN_CANCEL_CASCADE_API_ID = '00000000-0000-4000-8000-000000000005';

const now = new Date().toISOString();
const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
const nextWeek = new Date(Date.now() + 7 * 86400_000).toISOString();

// Distinct hour-spaced timestamps for the `runs-page`/`agent-runs-page`/
// `audit-events-page` journeys (Monitoring pagination + KPI E2E coverage).
// Keyset pagination orders newest-first, so each fixture group needs
// strictly increasing timestamps to make page boundaries deterministic.
const fiveHoursAgo = new Date(Date.now() - 5 * 3600_000).toISOString();
const fourHoursAgo = new Date(Date.now() - 4 * 3600_000).toISOString();
const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();

// Minute-spaced timestamps for monitoring.journey.ts's Load-More E2E
// fixtures (21 rows per tab — one over PAGE_SIZE=20 — generated in a loop
// rather than hand-written, since determinism only needs strictly
// increasing values and 21 hour-spaced constants would need almost a full
// day of headroom for no added benefit).
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

// Local-dev-only: gives the Agents-tab "Log" column something real to show
// via the actual AgentLogViewer pipeline (an AgentEvent announcing a log
// file path, which /api/step-logs reads from disk) instead of mocking the
// UI. postgres-seed.ts writes this content to
// `${tmpdir()}/mediforce-step-logs/${AGENT_LOG_FILENAME}` alongside the
// agent_events insert for RUN_COMPLETED_1_ID's step.
export const AGENT_LOG_FILENAME = 'seed-narrative-summary.jsonl';
export const AGENT_LOG_FIXTURE_CONTENT = [
  { ts: oneHourAgo, type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: '/workspace/vendor-submissions.csv' } },
  { ts: oneHourAgo, type: 'tool_result', tool_name: 'Read', content: '12 rows loaded, all fields present.' },
  { ts: oneHourAgo, type: 'assistant', subtype: 'tool_call', tool: 'Bash', input: { command: 'grep -c missing vendor-submissions.csv' } },
  { ts: oneHourAgo, type: 'tool_result', tool_name: 'Bash', content: '0' },
  { ts: oneHourAgo, type: 'assistant', subtype: 'text', text: 'Reviewed 12 vendor submissions. No issues detected. All items within expected parameters.' },
  { ts: now, type: 'result', subtype: 'completed' },
].map((entry) => JSON.stringify(entry)).join('\n');

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
    // Dedicated tasks for verdict-with-params.journey.ts — isolated from all
    // other tests so submitting the pending task never pollutes shared state.
    'task-param-verdict-target': {
      id: 'task-param-verdict-target',
      processInstanceId: 'proc-param-verdict-target',
      stepId: 'supply-chain-assessment',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: nextWeek,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completionData: null,
      params: [
        { name: 'findings', type: 'string', required: true, description: 'Summary of assessment findings' },
        { name: 'riskScore', type: 'number', required: false, description: 'Risk score 1–10' },
      ],
      verdicts: [
        { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
        { key: 'reject', label: 'Reject', intent: 'danger', requiresComment: true },
      ],
    },
    // Already-completed variant — used by the read-only CompletionReadOnly test
    'task-param-verdict-completed': {
      id: 'task-param-verdict-completed',
      processInstanceId: 'proc-completed-1',
      stepId: 'supply-chain-assessment',
      assignedRole: 'reviewer',
      assignedUserId: testUserId,
      status: 'completed',
      deadline: null,
      createdAt: oneHourAgo,
      updatedAt: now,
      completedAt: now,
      completionData: {
        verdict: 'approve',
        paramValues: { findings: 'All vendor checks passed', riskScore: 2 },
        completedBy: testUserId,
        completedAt: now,
      },
      params: [
        { name: 'findings', type: 'string', required: true, description: 'Summary of assessment findings' },
        { name: 'riskScore', type: 'number', required: false, description: 'Risk score 1–10' },
      ],
      verdicts: [
        { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
        { key: 'reject', label: 'Reject', intent: 'danger', requiresComment: true },
      ],
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
      namespace: 'test',
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
      namespace: 'test',
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
    // Dedicated API E2E target for issue #912 — cancel must reap the in-flight
    // step_execution and agent_run rows owned by this instance.
    'proc-cancel-cascade-api': {
      id: 'proc-cancel-cascade-api',
      namespace: 'test',
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
      namespace: 'test',
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
      namespace: 'test',
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
      namespace: 'test',
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
    // Pre-seeded cancelled run — used by status-badges test to verify Cancelled badge
    'proc-cancelled-1': {
      id: 'proc-cancelled-1',
      namespace: 'test',
      definitionName: 'Supply Chain Review',
      definitionVersion: '1.0.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'failed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: threeDaysAgo,
      createdBy: 'system',
      pauseReason: null,
      error: 'Cancelled by user',
      assignedRoles: [],
    },
    'proc-completed-2': {
      id: 'proc-completed-2',
      namespace: 'test',
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
    // Dedicated completed instance for archive-from-list journey — isolated so
    // archiving doesn't affect other tests that read proc-completed-1/2.
    // `createdAt: oneHourAgo` (not threeDaysAgo): the Monitoring → Workflows
    // tab / standalone `/runs` page default to the newest 20 runs
    // (server-side pagination) — a `threeDaysAgo` row falls off page 1 once
    // enough newer fixtures exist, so this journey's target row needs to
    // stay recent to remain deterministically visible without a Load More.
    'proc-archive-target': {
      id: 'proc-archive-target',
      namespace: 'test',
      definitionName: 'Data Quality Review',
      definitionVersion: '2.1.0',
      configName: 'all-human',
      configVersion: '1',
      status: 'completed',
      currentStepId: null,
      variables: { studyId: 'study-archive' },
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: twoDaysAgo,
      createdBy: testUserId,
      pauseReason: null,
      error: null,
      assignedRoles: ['reviewer'],
    },
    'proc-human-waiting': {
      id: 'proc-human-waiting',
      namespace: 'test',
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
      namespace: 'test',
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
    // Dedicated instance for verdict-with-params.journey.ts — isolated so
    // submitting task-param-verdict-target does not pollute other tests.
    // Uses 'Param Verdict Test:1' which contains the supply-chain-assessment
    // step so advanceStep succeeds after task completion (Supply Chain Review
    // v1 does not have this step and would throw a 500).
    'proc-param-verdict-target': {
      id: 'proc-param-verdict-target',
      namespace: 'test',
      definitionName: 'Param Verdict Test',
      definitionVersion: '1',
      status: 'paused',
      currentStepId: 'supply-chain-assessment',
      variables: { studyId: 'study-pv-target' },
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
      namespace: 'test',
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
      namespace: 'test',
      definitionName: 'Protocol to TFL',
      definitionVersion: '1.0.0',
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
      namespace: 'test',
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
      namespace: 'test',
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
      namespace: 'test',
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
    // Dedicated runs for runs-names.journey.ts (GET /api/runs/names, #588).
    // Unique definitionNames + ids so the projected { id, definitionName }
    // assertions are deterministic. `proc-names-deleted` carries a non-null
    // `deletedAt` tombstone so the journey can assert soft-deleted runs are
    // excluded by the `isNull(deletedAt)` filter.
    'proc-names-journey-1': {
      id: 'proc-names-journey-1',
      namespace: 'test',
      definitionName: 'Names Journey Workflow A',
      definitionVersion: '1.0.0',
      status: 'completed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    },
    'proc-names-journey-2': {
      id: 'proc-names-journey-2',
      namespace: 'test',
      definitionName: 'Names Journey Workflow B',
      definitionVersion: '1.0.0',
      status: 'completed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    },
    'proc-names-journey-deleted': {
      id: 'proc-names-journey-deleted',
      namespace: 'test',
      definitionName: 'Names Journey Soft Deleted',
      definitionVersion: '1.0.0',
      status: 'completed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
      deletedAt: twoDaysAgo,
    },
    // Dedicated runs for runs-page.journey.ts (GET /api/runs/page +
    // GET /api/runs/status-counts). Unique `definitionName` so the
    // `workflow` filter isolates exactly these 5 rows, one per
    // `WorkflowDisplayStatus` bucket — status-counts assertions stay exact
    // even while parallel journeys mutate other runs under the shared
    // `test` namespace. Distinct hour-spaced `createdAt` values make the
    // newest-first keyset order deterministic: 5 (newest) → 1 (oldest).
    'proc-runs-page-journey-1': {
      id: 'proc-runs-page-journey-1',
      namespace: 'test',
      definitionName: 'Runs Page Journey Workflow',
      definitionVersion: '1.0.0',
      status: 'completed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: fiveHoursAgo,
      updatedAt: fiveHoursAgo,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    },
    'proc-runs-page-journey-2': {
      id: 'proc-runs-page-journey-2',
      namespace: 'test',
      definitionName: 'Runs Page Journey Workflow',
      definitionVersion: '1.0.0',
      status: 'running',
      currentStepId: 'in-progress-step',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: fourHoursAgo,
      updatedAt: fourHoursAgo,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    },
    'proc-runs-page-journey-3': {
      id: 'proc-runs-page-journey-3',
      namespace: 'test',
      definitionName: 'Runs Page Journey Workflow',
      definitionVersion: '1.0.0',
      status: 'paused',
      currentStepId: 'waiting-step',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: threeHoursAgo,
      updatedAt: threeHoursAgo,
      createdBy: 'system',
      pauseReason: 'waiting_for_human',
      error: null,
      assignedRoles: [],
    },
    'proc-runs-page-journey-4': {
      id: 'proc-runs-page-journey-4',
      namespace: 'test',
      definitionName: 'Runs Page Journey Workflow',
      definitionVersion: '1.0.0',
      status: 'failed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: twoHoursAgo,
      updatedAt: twoHoursAgo,
      createdBy: 'system',
      pauseReason: null,
      error: 'Cancelled by user',
      assignedRoles: [],
    },
    'proc-runs-page-journey-5': {
      id: 'proc-runs-page-journey-5',
      namespace: 'test',
      definitionName: 'Runs Page Journey Workflow',
      definitionVersion: '1.0.0',
      status: 'failed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
      createdBy: 'system',
      pauseReason: null,
      error: 'Agent timeout after 30s',
      assignedRoles: [],
    },
    // Parent instance for agent-runs-page.journey.ts (GET /api/agent-runs +
    // GET /api/agent-runs/card-status-counts). The four agent runs below
    // (see `agentRuns`) all point at this instance so tests can scope with
    // `processInstanceId=proc-agent-runs-page-journey` and stay unaffected
    // by parallel journeys' agent runs in the shared `test` namespace.
    'proc-agent-runs-page-journey': {
      id: 'proc-agent-runs-page-journey',
      namespace: 'test',
      definitionName: 'Agent Runs Page Journey Workflow',
      definitionVersion: '1.0.0',
      status: 'running',
      currentStepId: 'step-running',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: fourHoursAgo,
      updatedAt: now,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    },
    // Parent instance for monitoring.journey.ts's Agents-tab Load More +
    // "KPI cards report the real DB count, not just the loaded rows" L4 UI
    // coverage (distinct from agent-runs-page.journey.ts's L3 API coverage
    // above). Unique `definitionName` so the Agents tab's own "Workflow"
    // filter <select> isolates exactly the 21 agent runs below (see
    // `monitoringLoadMoreAgentRuns`) — an exact filter, not a KPI-bucket
    // lower bound.
    'proc-monitoring-loadmore-agents': {
      id: 'proc-monitoring-loadmore-agents',
      namespace: 'test',
      definitionName: 'Monitoring LoadMore Agent Workflow',
      definitionVersion: '1.0.0',
      status: 'running',
      currentStepId: 'step-monitoring-loadmore',
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: minutesAgo(50_000),
      updatedAt: now,
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    },
  };

  // 21 dry runs for monitoring.journey.ts's Workflows-tab Load More
  // coverage. No pre-existing fixture in this file sets `dryRun: true` (nor
  // does any UI journey create one live), so the Workflows tab's "Dry Runs"
  // filter is otherwise completely empty — an exact isolation mechanism,
  // unlike the tab's KPI-bucket clicks (which have no equivalent guarantee
  // against collision with other journeys' runs in the same status bucket).
  // PAGE_SIZE=20, so 21 rows makes Load More deterministic: 20 -> 21 ->
  // button gone. Minute-spaced `createdAt`, newest first (i=1 newest).
  const WORKFLOWS_LOADMORE_DRY_RUN_COUNT = 21;
  for (let i = 1; i <= WORKFLOWS_LOADMORE_DRY_RUN_COUNT; i++) {
    const id = `proc-workflows-loadmore-dryrun-${i}`;
    processInstances[id] = {
      id,
      namespace: 'test',
      definitionName: 'Workflows LoadMore Dry Run Workflow',
      definitionVersion: '1.0.0',
      status: 'completed',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      dryRun: true,
      createdAt: minutesAgo(i),
      updatedAt: minutesAgo(i),
      createdBy: 'system',
      pauseReason: null,
      error: null,
      assignedRoles: [],
    };
  }

  const MONITORING_LOADMORE_AGENT_RUN_COUNT = 21;
  // 21 agent runs, all `running` with `fallbackReason: null` — avoids the
  // running/error double-count landmine noted below (`error` bucket keys
  // off `fallbackReason` alone, regardless of `status`). PAGE_SIZE=20, so
  // 21 rows makes Load More deterministic: 20 -> 21 -> button gone.
  // Minute-spaced `startedAt`, newest first (i=1 newest) — offset by
  // 50,000 minutes (~34 days), well past `threeDaysAgo` (the oldest named
  // constant above), so this batch never crowds the Agents tab's
  // *unfiltered* top-20 view out from under other tests in this file that
  // assert on specific rows there (e.g. the `twoDaysAgo`-started escalated
  // run) — isolation for our own tests comes from the workflow filter, not
  // from recency.
  const monitoringLoadMoreAgentRuns: Record<string, Record<string, unknown>> = {};
  for (let i = 1; i <= MONITORING_LOADMORE_AGENT_RUN_COUNT; i++) {
    const id = `20000000-0000-4000-9000-${String(i).padStart(12, '0')}`;
    monitoringLoadMoreAgentRuns[id] = {
      id,
      processInstanceId: 'proc-monitoring-loadmore-agents',
      stepId: `step-monitoring-loadmore-${i}`,
      pluginId: 'monitoring-loadmore-plugin',
      autonomyLevel: 'L1',
      status: 'running',
      envelope: null,
      fallbackReason: null,
      startedAt: minutesAgo(50_000 + i),
      completedAt: null,
      executorType: 'agent',
      reviewerType: 'none',
    };
  }

  const agentRuns: Record<string, Record<string, unknown>> = {
    [RUN_COMPLETED_1_ID]: {
      id: RUN_COMPLETED_1_ID,
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
    [RUN_ESCALATED_1_ID]: {
      id: RUN_ESCALATED_1_ID,
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
    [RUN_RUNNING_1_ID]: {
      id: RUN_RUNNING_1_ID,
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
    [RUN_CANCEL_CASCADE_API_ID]: {
      id: RUN_CANCEL_CASCADE_API_ID,
      processInstanceId: 'proc-cancel-cascade-api',
      stepId: 'narrative-summary',
      pluginId: 'narrative-summary',
      autonomyLevel: 'L2',
      status: 'running',
      envelope: null,
      fallbackReason: null,
      startedAt: now,
      completedAt: null,
      executorType: 'agent',
      reviewerType: 'none',
    },
    [RUN_L4_AUTOPILOT_ID]: {
      id: RUN_L4_AUTOPILOT_ID,
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
    // Dedicated runs for agent-runs-page.journey.ts, one per
    // `AgentRunCardStatus` bucket (running/completed/error/flagged — see
    // `cardStatusConditions` in process-instance-repository.ts's agent-run
    // counterpart). All parented to `proc-agent-runs-page-journey` so
    // `processInstanceId` filtering isolates them from concurrent journeys.
    // `agent_runs.id` is a Postgres uuid column — fixed v4-shaped literals,
    // distinct from the `...8000...` series above. Distinct hour-spaced
    // `startedAt` values make the newest-first keyset order deterministic:
    // running (newest) → completed → error → flagged (oldest).
    '00000000-0000-4000-9000-000000000001': {
      id: '00000000-0000-4000-9000-000000000001',
      processInstanceId: 'proc-agent-runs-page-journey',
      stepId: 'step-flagged',
      pluginId: 'page-journey-plugin',
      autonomyLevel: 'L3',
      status: 'escalated',
      envelope: null,
      fallbackReason: 'low_confidence',
      startedAt: fourHoursAgo,
      completedAt: fourHoursAgo,
      executorType: 'agent',
      reviewerType: 'human',
    },
    '00000000-0000-4000-9000-000000000002': {
      id: '00000000-0000-4000-9000-000000000002',
      processInstanceId: 'proc-agent-runs-page-journey',
      stepId: 'step-error',
      pluginId: 'page-journey-plugin',
      autonomyLevel: 'L2',
      // `error` bucket is driven purely by `fallbackReason`, not `status`
      // (see `cardStatusConditions` in agent-run-repository.ts) — `status`
      // must be something other than 'completed'/'running'/'escalated'/
      // 'flagged' here, or this row would double-count into that bucket too.
      status: 'interrupted',
      envelope: null,
      fallbackReason: 'error',
      startedAt: threeHoursAgo,
      completedAt: threeHoursAgo,
      executorType: 'agent',
      reviewerType: 'none',
    },
    '00000000-0000-4000-9000-000000000003': {
      id: '00000000-0000-4000-9000-000000000003',
      processInstanceId: 'proc-agent-runs-page-journey',
      stepId: 'step-completed',
      pluginId: 'page-journey-plugin',
      autonomyLevel: 'L2',
      status: 'completed',
      envelope: null,
      fallbackReason: null,
      startedAt: twoHoursAgo,
      completedAt: twoHoursAgo,
      executorType: 'agent',
      reviewerType: 'none',
    },
    '00000000-0000-4000-9000-000000000004': {
      id: '00000000-0000-4000-9000-000000000004',
      processInstanceId: 'proc-agent-runs-page-journey',
      stepId: 'step-running',
      pluginId: 'page-journey-plugin',
      autonomyLevel: 'L1',
      status: 'running',
      envelope: null,
      fallbackReason: null,
      startedAt: oneHourAgo,
      completedAt: null,
      executorType: 'agent',
      reviewerType: 'none',
    },
    ...monitoringLoadMoreAgentRuns,
  };

  const agentEvents: Record<string, Record<string, unknown>> = {
    'agent-event-1': {
      processInstanceId: 'proc-running-1',
      stepId: 'narrative-summary',
      type: 'status',
      payload: `agent activity log: /tmp/mediforce-step-logs/${AGENT_LOG_FILENAME}`,
      sequence: 0,
      timestamp: oneHourAgo,
    },
  };

  const MONITORING_LOADMORE_ACTOR_ID = 'monitoring-loadmore-actor';
  const MONITORING_LOADMORE_EVENT_COUNT = 21;
  // 21 audit events, one PAGE_SIZE(20) over the limit, shared by
  // monitoring.journey.ts's Users AND Tasks tab Load-More tests —
  // `task.completed` is a member of both USER_ACTIVITY_ACTIONS and
  // TASK_ACTIVITY_ACTIONS, so the same batch isolates cleanly on either
  // tab. Unique `actorId` + the matching `namespaceMembers` entry below
  // (so the tab's own "User" filter <select> can select it) gives exact
  // isolation from whatever parallel journeys write to the shared `test`
  // namespace. Minute-spaced `timestamp`, newest first (i=1 newest) —
  // offset by 50,000 minutes (~34 days), well past `threeDaysAgo` (the
  // oldest named constant above), so this batch never crowds the Users/
  // Tasks tabs' *unfiltered* top-20 view out from under other tests in
  // this file that assert on specific rows there (e.g. `audit-workflow-
  // cancelled` at `twoDaysAgo`) — isolation for our own tests comes from
  // the actor filter, not from recency.
  const monitoringLoadMoreAuditEvents: Record<string, Record<string, unknown>> = {};
  for (let i = 1; i <= MONITORING_LOADMORE_EVENT_COUNT; i++) {
    monitoringLoadMoreAuditEvents[`audit-monitoring-loadmore-${i}`] = {
      actorId: MONITORING_LOADMORE_ACTOR_ID,
      actorType: 'user',
      actorRole: 'member',
      action: 'task.completed',
      description: `Monitoring load-more fixture event ${i}`,
      timestamp: minutesAgo(50_000 + i),
      inputSnapshot: { taskId: `task-monitoring-loadmore-${i}`, stepId: 'monitoring-loadmore-step' },
      outputSnapshot: { status: 'completed' },
      basis: 'Fixture for monitoring.journey.ts Load More coverage',
      entityType: 'humanTask',
      entityId: `task-monitoring-loadmore-${i}`,
    };
  }

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
    // Monitoring → Users tab fixtures. No processInstanceId, so
    // postgres-seed.ts's workspace resolution falls back to TEST_ORG_HANDLE
    // — same behaviour as a real sign-in event with no parent run.
    'audit-signin-password': {
      actorId: testUserId,
      actorType: 'user',
      actorRole: 'owner',
      action: 'user.signed_in',
      description: 'Signed in with email and password',
      timestamp: oneHourAgo,
      inputSnapshot: { method: 'password', ipAddress: '203.0.113.42', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      outputSnapshot: {},
      basis: 'Password credential verified',
      entityType: 'user',
      entityId: testUserId,
    },
    'audit-signin-oauth': {
      actorId: testUserId,
      actorType: 'user',
      actorRole: 'owner',
      action: 'user.signed_in',
      description: 'Signed in via google (SSO)',
      timestamp: twoDaysAgo,
      inputSnapshot: { method: 'oauth', provider: 'google' },
      outputSnapshot: {},
      basis: "OAuth provider 'google' verified the identity",
      entityType: 'user',
      entityId: testUserId,
    },
    'audit-workflow-triggered': {
      actorId: testUserId,
      actorType: 'user',
      actorRole: 'owner',
      action: 'instance.started',
      description: `Started instance 'proc-running-1'`,
      timestamp: oneHourAgo,
      inputSnapshot: { instanceId: 'proc-running-1' },
      outputSnapshot: { currentStepId: 'narrative-summary' },
      basis: 'Instance start',
      entityType: 'processInstance',
      entityId: 'proc-running-1',
      processInstanceId: 'proc-running-1',
      processDefinitionVersion: '1',
    },
    'audit-workflow-cancelled': {
      actorId: testUserId,
      actorType: 'user',
      actorRole: 'owner',
      action: 'instance.cancelled',
      description: `Run cancelled by operator (was running at step 'data-quality')`,
      timestamp: twoDaysAgo,
      inputSnapshot: { previousStatus: 'running', currentStepId: 'data-quality' },
      outputSnapshot: { status: 'failed', error: 'Cancelled by user' },
      basis: 'User-initiated cancel via UI — double-confirm pattern',
      entityType: 'processInstance',
      entityId: 'proc-completed-1',
      processInstanceId: 'proc-completed-1',
      processDefinitionVersion: '2.1.0',
    },
    'audit-task-completed': {
      actorId: testUserId,
      actorType: 'user',
      actorRole: 'owner',
      action: 'task.completed',
      description: `Task resolved for step 'manager-approval'`,
      timestamp: now,
      inputSnapshot: { taskId: 'task-manager-approval', stepId: 'manager-approval' },
      outputSnapshot: { status: 'completed' },
      basis: 'Task resolved via API',
      entityType: 'humanTask',
      entityId: 'task-manager-approval',
      processInstanceId: 'proc-running-1',
      stepId: 'manager-approval',
    },
    'audit-task-claimed': {
      actorId: testUserId,
      actorType: 'user',
      actorRole: 'owner',
      action: 'task.claimed',
      description: `User '${testUserId}' claimed task 'task-claimed-1' for step 'approve-report'`,
      timestamp: oneHourAgo,
      inputSnapshot: { taskId: 'task-claimed-1', userId: testUserId, stepId: 'approve-report' },
      outputSnapshot: { status: 'claimed', assignedUserId: testUserId },
      basis: 'User claimed task via UI',
      entityType: 'humanTask',
      entityId: 'task-claimed-1',
      processInstanceId: 'proc-running-1',
    },
    // Dedicated events for audit-events-page.journey.ts (GET
    // /api/audit-events). Unique `actorId` so filtering on it isolates
    // exactly these 3 rows from concurrent journeys' events in the shared
    // `test` namespace. No `processInstanceId`, so postgres-seed.ts's
    // workspace resolution falls back to TEST_ORG_HANDLE — same pattern as
    // `audit-signin-password`. Distinct hour-spaced timestamps make the
    // newest-first keyset order deterministic: 3 (newest) → 1 (oldest).
    // Event 3 uses a different `action` to exercise the `action` filter.
    'audit-page-journey-1': {
      actorId: 'audit-page-journey-actor',
      actorType: 'user',
      actorRole: 'owner',
      action: 'user.signed_in',
      description: 'Page journey fixture event 1',
      timestamp: threeHoursAgo,
      inputSnapshot: {},
      outputSnapshot: {},
      basis: 'Fixture for audit-events-page.journey.ts',
      entityType: 'user',
      entityId: 'audit-page-journey-actor',
    },
    'audit-page-journey-2': {
      actorId: 'audit-page-journey-actor',
      actorType: 'user',
      actorRole: 'owner',
      action: 'user.signed_in',
      description: 'Page journey fixture event 2',
      timestamp: twoHoursAgo,
      inputSnapshot: {},
      outputSnapshot: {},
      basis: 'Fixture for audit-events-page.journey.ts',
      entityType: 'user',
      entityId: 'audit-page-journey-actor',
    },
    'audit-page-journey-3': {
      actorId: 'audit-page-journey-actor',
      actorType: 'user',
      actorRole: 'owner',
      action: 'task.completed',
      description: 'Page journey fixture event 3',
      timestamp: oneHourAgo,
      inputSnapshot: {},
      outputSnapshot: {},
      basis: 'Fixture for audit-events-page.journey.ts',
      entityType: 'humanTask',
      entityId: 'audit-page-journey-actor',
    },
    ...monitoringLoadMoreAuditEvents,
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
    'exec-cancel-cascade-api': {
      id: 'exec-cancel-cascade-api',
      instanceId: 'proc-cancel-cascade-api',
      stepId: 'narrative-summary',
      status: 'running',
      input: { participantIds: ['p-912'] },
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

  const workflowDefinitions: Record<string, Record<string, unknown>> = {
    // Backs `proc-upload-waiting` / `task-upload-docs` (the file-upload task).
    // Trimmed to the human upload step + a terminal so completing the upload
    // advances the run without spawning the real agent pipeline (ADR-0003 E2E).
    'test:Protocol to TFL:1': {
      name: 'Protocol to TFL',
      namespace: 'test',
      version: 1,
      title: 'Protocol to TFL pipeline',
      description: 'Upload protocol documents (E2E-trimmed to the upload step).',
      workspace: {},
      steps: [
        {
          id: 'upload-documents',
          name: 'Upload Documents',
          type: 'creation',
          executor: 'human',
          description: 'Upload protocol PDF and SAP document',
          ui: {
            component: 'file-upload',
            config: { acceptedTypes: ['application/pdf'], minFiles: 1, maxFiles: 5 },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'upload-documents', to: 'done' }],
    },
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
    'test:Sales CSV Report:1': {
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
          script: {
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
          script: {
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
      createdAt: twoDaysAgo,
    },
    'test:Supply Chain Review:1': {
      name: 'Supply Chain Review',
      namespace: 'test',
      version: 1,
      title: 'Initial vendor assessment workflow',
      description: 'End-to-end supply chain review process',
      steps: [
        { id: 'vendor-assessment', name: 'Vendor Assessment', type: 'creation', executor: 'agent', autonomyLevel: 'L2', plugin: 'supply-data-collector', agent: { skill: 'vendor-assessment', mcpServers: [{ name: 'postgres-ro', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { DATABASE_URL: '{{DB_URL}}' }, allowedTools: ['query'] }, { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'] }] } },
        { id: 'narrative-summary', name: 'Narrative Summary', type: 'creation', executor: 'agent', autonomyLevel: 'L3', agent: { allowedTools: ['WebFetch'] } },
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
      createdAt: twoDaysAgo,
    },
    'test:Data Quality Review:2': {
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
      createdAt: threeDaysAgo,
    },
    // Backs `proc-agent-runs-page-journey` (see `processInstances` above,
    // added earlier this session for agent-runs-page.journey.ts's L3 API
    // coverage). That fixture set never got a matching `workflowDefinitions`
    // entry, which is harmless for the API-only journey but 404s `GET
    // /api/processes/:id/steps` the moment the Agents tab actually *renders*
    // one of these runs (AgentRunListTable's `PermissionsCell` calls it per
    // row) — a real pre-existing bug this L4 UI journey newly exercises.
    // Fixed here rather than filed as a follow-up: additive, one fixture
    // object, same shape as the entry below it.
    'test:Agent Runs Page Journey Workflow:1': {
      name: 'Agent Runs Page Journey Workflow',
      namespace: 'test',
      version: 1,
      title: 'Agent Runs Page Journey Workflow',
      description: 'Minimal definition backing agent-runs-page.journey.ts\'s fixtures, added so the Agents tab (which resolves per-row step permissions) doesn\'t 404 when it renders these runs.',
      steps: [
        { id: 'step-running', name: 'Step Running', type: 'review', executor: 'agent', agent: { allowedTools: [] } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'step-running', to: 'done' }],
      createdAt: fourHoursAgo,
    },
    // Backs `proc-monitoring-loadmore-agents` (see `processInstances` above)
    // — exists only so `GET /api/processes/:id/steps` (called per row by
    // AgentRunListTable's `PermissionsCell` in the live Agents tab) resolves
    // instead of 404ing; the fixture agent runs' individual stepIds don't
    // need to match an entry here (`useStepAllowedTools` degrades to "no
    // data" on a miss, same as any step with no allowed-tools list).
    'test:Monitoring LoadMore Agent Workflow:1': {
      name: 'Monitoring LoadMore Agent Workflow',
      namespace: 'test',
      version: 1,
      title: 'Monitoring LoadMore Agent Workflow',
      description: 'Minimal definition backing monitoring.journey.ts\'s Agents-tab Load More fixtures.',
      steps: [
        { id: 'step-monitoring-loadmore', name: 'Monitoring LoadMore Step', type: 'review', executor: 'agent', agent: { allowedTools: [] } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'step-monitoring-loadmore', to: 'done' }],
      createdAt: minutesAgo(50_000),
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
    // Synthetic member for monitoring.journey.ts's Users/Tasks Load-More
    // tests — no corresponding real auth account needed (`workspace_members`
    // has no FK on `uid`; see postgres-seed.ts's writer). Its only purpose
    // is to make `monitoring-loadmore-actor` selectable in the Users/Tasks
    // tabs' "User" filter <select>, which is populated from real workspace
    // members, not from the audit events themselves.
    [MONITORING_LOADMORE_ACTOR_ID]: {
      id: MONITORING_LOADMORE_ACTOR_ID,
      uid: MONITORING_LOADMORE_ACTOR_ID,
      role: 'member',
      joinedAt: threeDaysAgo,
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
  // races with the first GET `/api/agents/:id` request.
  //
  // `mcp-test-agent` is a fixture consumed by step-mcp-restrictions.journey.ts —
  // it ships with one pre-bound stdio server so the Restrictions section has
  // something to narrow. Journey 2 uses `claude-code-agent`, which must start
  // binding-free for its "empty state" assertion; hence the split.
  const agentDefinitions: Record<string, Record<string, unknown>> = {
    'claude-code-agent': {
      kind: 'plugin',
      visibility: 'public',
      runtimeId: 'claude-code-agent',
      name: 'Claude Code Agent',
      iconName: 'Bot',
      description:
        "Executes code generation, analysis, and automated software tasks using Claude's advanced coding capabilities.",
      inputDescription: 'Task description and relevant code context',
      outputDescription: 'Generated code, analysis results, or task completion report',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: '',
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    },
    'mcp-test-agent': {
      kind: 'plugin',
      namespace: 'test',
      runtimeId: 'script-container',
      name: 'MCP Test Agent',
      iconName: 'Terminal',
      description: 'Fixture agent for step-level MCP restrictions journey.',
      inputDescription: 'test input',
      outputDescription: 'test output',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: '',
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
      namespace: 'test',
      runtimeId: 'claude-code-agent',
      name: 'OAuth Test Agent',
      iconName: 'Bot',
      description: 'Fixture agent for the per-agent OAuth journey.',
      inputDescription: 'task input',
      outputDescription: 'task output',
      foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: '',
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
  workflowDefinitions['test:MCP Restrictions Test:1'] = {
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
        plugin: 'claude-code-agent',
        agentId: 'mcp-test-agent',
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'process', to: 'done' }],
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
    namespace: 'test',
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
  workflowDefinitions['test:Workflow Designer:1'] = {
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
    createdAt: twoDaysAgo,
  };

  workflowDefinitions['test:Diagram Branch Accordion:1'] = {
    name: 'Diagram Branch Accordion',
    namespace: 'test',
    version: 1,
    description: 'Test workflow for branch accordion diagram feature',
    steps: [
      { id: 'classify', name: 'Classify Document', type: 'decision', executor: 'agent', autonomyLevel: 'L2' },
      { id: 'process-standard', name: 'Standard Processing', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
      { id: 'process-urgent', name: 'Urgent Processing', type: 'creation', executor: 'human' },
      { id: 'finalize', name: 'Finalize', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [
      { from: 'classify', to: 'process-standard', when: 'output.type == "standard"' },
      { from: 'classify', to: 'process-urgent', when: 'output.type == "urgent"' },
      { from: 'process-standard', to: 'finalize' },
      { from: 'process-urgent', to: 'finalize' },
      { from: 'finalize', to: 'done' },
    ],
    createdAt: twoDaysAgo,
  };

  workflowDefinitions['test:Diagram Back Edge:1'] = {
    name: 'Diagram Back Edge',
    namespace: 'test',
    version: 1,
    description: 'Test workflow for back-edge diagram feature',
    steps: [
      { id: 'draft', name: 'Draft Document', type: 'creation', executor: 'human' },
      {
        id: 'review',
        name: 'Review Document',
        type: 'review',
        executor: 'human',
        verdicts: {
          approve: { target: 'done' },
          revise: { target: 'draft' },
        },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [
      { from: 'draft', to: 'review' },
    ],
    createdAt: twoDaysAgo,
  };

  workflowDefinitions['test:Trigger Input Test:1'] = {
    name: 'Trigger Input Test',
    namespace: 'test',
    version: 1,
    title: 'Workflow with trigger inputs',
    description: 'Test workflow that requires trigger input fields at start',
    steps: [
      { id: 'process', name: 'Process Data', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'process', to: 'done' }],
    triggerInput: [
      { name: 'studyId', type: 'string', required: true, description: 'Study identifier' },
      { name: 'priority', type: 'select', required: false, options: ['low', 'normal', 'high'], default: 'normal', description: 'Run priority' },
      { name: 'dryRun', type: 'boolean', required: false, default: false, description: 'Dry run mode' },
    ],
    createdAt: twoDaysAgo,
  };

  // Minimal workflow for verdict-with-params.journey.ts. Contains the
  // supply-chain-assessment step so advanceStep succeeds when the test submits
  // the task — Supply Chain Review v1 lacks this step and would 500.
  workflowDefinitions['test:Param Verdict Test:1'] = {
    name: 'Param Verdict Test',
    namespace: 'test',
    version: 1,
    description: 'Fixture workflow for verdict-with-params journey',
    steps: [
      { id: 'supply-chain-assessment', name: 'Supply Chain Assessment', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'supply-chain-assessment', to: 'done' }],
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

  const modelRegistry: Record<string, Record<string, unknown>> = {
    'anthropic__claude-sonnet-4': {
      id: 'anthropic/claude-sonnet-4',
      name: 'Claude Sonnet 4',
      provider: 'anthropic',
      contextLength: 200000,
      maxCompletionTokens: 64000,
      pricing: { input: 0.000003, output: 0.000015 },
      modality: 'text+image->text',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: true,
      source: 'openrouter',
      canonicalSlug: null,
      requestCount: 5200000,
      lastSyncedAt: now,
      createdAt: oneHourAgo,
      updatedAt: now,
    },
    'deepseek__deepseek-chat': {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek Chat',
      provider: 'deepseek',
      contextLength: 64000,
      maxCompletionTokens: 8192,
      pricing: { input: 0.00000014, output: 0.00000028 },
      modality: 'text->text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: false,
      supportsVision: false,
      source: 'openrouter',
      canonicalSlug: null,
      requestCount: 890000,
      lastSyncedAt: now,
      createdAt: oneHourAgo,
      updatedAt: now,
    },
    'openai__gpt-4o': {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      contextLength: 128000,
      maxCompletionTokens: 16384,
      pricing: { input: 0.0000025, output: 0.00001 },
      modality: 'text+image->text',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: true,
      source: 'openrouter',
      canonicalSlug: null,
      requestCount: 3100000,
      lastSyncedAt: now,
      createdAt: oneHourAgo,
      updatedAt: now,
    },
  };

  // Match prod write shape — WorkflowEngine.createInstance writes `deleted: false`
  // AND `archived: false` on every instance. Both the runs.list query and the
  // home-card `summarizeRunsByWorkflow` aggregate filter server-side via
  // `.where('deleted','==',false).where('archived','==',false)`. Firestore
  // equality where-clauses do not match docs missing the field, so seeded rows
  // without these fields are hidden (empty run counts + empty card previews).
  for (const key of Object.keys(processInstances)) {
    if (processInstances[key].deleted === undefined) {
      processInstances[key].deleted = false;
    }
    if (processInstances[key].archived === undefined) {
      processInstances[key].archived = false;
    }
  }

  return { humanTasks, processInstances, agentRuns, agentEvents, auditEvents, stepExecutions, humanWaitingStepExecutions, stepFailureStepExecutions, retryTestStepExecutions, agentEscalatedCancelStepExecutions, reviewTargetStepExecutions, processDefinitions, completedProcessStepExecutions, completedSupplyChainStepExecutions, processConfigs, workflowDefinitions, namespaces, namespaceMembers, coworkSessions, toolCatalog, oauthProviders, agentDefinitions, workflowRunStepExecutions, modelRegistry };
}
