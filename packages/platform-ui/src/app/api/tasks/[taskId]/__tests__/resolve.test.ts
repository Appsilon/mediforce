import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockGetById = vi.fn();
const mockClaim = vi.fn();
const mockComplete = vi.fn();
const mockAuditAppend = vi.fn();
const mockInstanceGetById = vi.fn();
const mockInstanceUpdate = vi.fn();
const mockAdvanceStep = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    humanTaskRepo: {
      getById: mockGetById,
      claim: mockClaim,
      complete: mockComplete,
    },
    auditRepo: { append: mockAuditAppend },
    instanceRepo: {
      getById: mockInstanceGetById,
      update: mockInstanceUpdate,
    },
    engine: { advanceStep: mockAdvanceStep, advanceWorkflowStep: mockAdvanceStep },
    namespaceRepo: {},
  }),
  getAppBaseUrl: () => 'http://localhost:3000',
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));

import { POST } from '../resolve/route';

// ---- Helpers ----

const makeParams = (taskId: string) => Promise.resolve({ taskId });

function makeRequest(taskId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${taskId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const pausedInstance = {
  id: 'inst-1',
  namespace: 'test-ns',
  status: 'paused',
  currentStepId: 'extract-metadata',
};

const advancedInstance = {
  id: 'inst-1',
  namespace: 'test-ns',
  status: 'running',
  currentStepId: 'extract-metadata',
};

// ---- Verdict resolution ----

describe('POST /api/tasks/:taskId/resolve — verdict', () => {
  const claimedVerdictTask = {
    id: 'task-1',
    processInstanceId: 'inst-1',
    stepId: 'review-output',
    assignedRole: 'reviewer',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: undefined,
    createdAt: '2026-03-12T10:00:00Z',
    updatedAt: '2026-03-12T10:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedVerdictTask, status: 'completed' });
  });

  it('[DATA] resolves a claimed verdict task with approve', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);
    // Return advanced instance on second call (for response)
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve', comment: 'LGTM' }),
      { params: makeParams('task-1') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.taskId).toBe('task-1');
    expect(json.resolvedStepId).toBe('review-output');
    expect(json.processInstanceId).toBe('inst-1');
    expect(json.nextStepId).toBe('extract-metadata');
    expect(json.status).toBe('running');
    expect(mockComplete).toHaveBeenCalledWith('task-1', expect.objectContaining({ verdict: 'approve', comment: 'LGTM' }));
    expect(mockAdvanceStep).toHaveBeenCalled();
    expect(mockAuditAppend).toHaveBeenCalledTimes(2);
  });

  it('[DATA] passes agent output for L3 review tasks', async () => {
    const l3Task = {
      ...claimedVerdictTask,
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: { extracted: true }, confidence: 0.9 },
      },
    };
    mockGetById.mockResolvedValue(l3Task);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput).toEqual({ extracted: true, verdict: 'approve' });
  });

  it('[DATA] auto-claims pending task before resolving', async () => {
    const pendingTask = { ...claimedVerdictTask, status: 'pending', assignedUserId: null };
    const afterClaim = { ...claimedVerdictTask, status: 'claimed', assignedUserId: 'api-user' };
    mockGetById.mockResolvedValue(pendingTask);
    mockClaim.mockResolvedValue(afterClaim);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith('task-1', 'api-user');
    expect(mockComplete).toHaveBeenCalled();
  });

  it('[ERROR] returns 400 for missing verdict', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);

    const res = await POST(
      makeRequest('task-1', { comment: 'no verdict' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('verdict');
  });

  it('[ERROR] returns 400 for invalid verdict value (no task.verdicts → legacy approve/revise allowlist)', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);

    const res = await POST(
      makeRequest('task-1', { verdict: 'reject' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(400);
  });

  it('[DATA] accepts a custom verdict key declared in task.verdicts (N-way)', async () => {
    const taskWithCustomVerdicts = {
      ...claimedVerdictTask,
      verdicts: [
        { key: 'accept', label: 'Accept delivery', intent: 'success', requiresComment: false },
        { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger', requiresComment: false },
        { key: 'ask_agent_to_revise', label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
      ],
    };
    mockGetById.mockResolvedValue(taskWithCustomVerdicts);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'reject_and_notify', comment: 'tables missing' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ verdict: 'reject_and_notify', comment: 'tables missing' }),
    );
    expect(mockAdvanceStep).toHaveBeenCalledWith(
      'inst-1',
      expect.objectContaining({ verdict: 'reject_and_notify' }),
      expect.any(Object),
    );
  });

  it('[ERROR] returns 400 for a verdict not declared in task.verdicts', async () => {
    mockGetById.mockResolvedValue({
      ...claimedVerdictTask,
      verdicts: [
        { key: 'accept', label: 'Accept', intent: 'success', requiresComment: false },
        { key: 'reject_and_notify', label: 'Reject', intent: 'danger', requiresComment: false },
      ],
    });

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not allowed/);
    expect(json.error).toMatch(/accept, reject_and_notify/);
  });

  it('[DATA] accepts a requiresComment verdict when a non-empty comment is supplied', async () => {
    mockGetById.mockResolvedValue({
      ...claimedVerdictTask,
      verdicts: [
        { key: 'ask_agent_to_revise', label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
      ],
    });
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'ask_agent_to_revise', comment: 'add unit count' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalled();
  });

  it('[ERROR] enforces requiresComment server-side — rejects empty comment with 400', async () => {
    // The UI gates the button, but a direct API caller could otherwise
    // bypass requiresComment by curling the endpoint with no comment. The
    // server reads the descriptor on task.verdicts and enforces.
    mockGetById.mockResolvedValue({
      ...claimedVerdictTask,
      verdicts: [
        { key: 'ask_agent_to_revise', label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
      ],
    });

    const res = await POST(
      makeRequest('task-1', { verdict: 'ask_agent_to_revise', comment: '   ' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/requires a non-empty comment/);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('[DATA] falls back to approve/revise allowlist when task has no verdicts field', async () => {
    // Pre-N-way tasks have no verdicts field. Both approve and revise must
    // still resolve cleanly so legacy in-flight tasks keep working.
    mockGetById.mockResolvedValue(claimedVerdictTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'revise', comment: 'rework' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ verdict: 'revise' }),
    );
  });

  it('[ERROR] returns 404 for unknown task', async () => {
    mockGetById.mockResolvedValue(null);

    const res = await POST(
      makeRequest('unknown', { verdict: 'approve' }),
      { params: makeParams('unknown') },
    );

    expect(res.status).toBe(404);
  });

  it('[ERROR] returns 409 for completed task', async () => {
    mockGetById.mockResolvedValue({ ...claimedVerdictTask, status: 'completed' });

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('completed');
  });

  it('[ERROR] returns 422 when approving L3 task with no agent output', async () => {
    const emptyOutputTask = {
      ...claimedVerdictTask,
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: null, confidence: null },
      },
    };
    mockGetById.mockResolvedValue(emptyOutputTask);
    mockInstanceGetById.mockResolvedValue(pausedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('no output');
    expect(mockAdvanceStep).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 422 when approving L3 task with empty object result', async () => {
    const emptyResultTask = {
      ...claimedVerdictTask,
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: {}, confidence: 0.5 },
      },
    };
    mockGetById.mockResolvedValue(emptyResultTask);
    mockInstanceGetById.mockResolvedValue(pausedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('no output');
    expect(mockAdvanceStep).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 409 when instance is not paused', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);
    mockInstanceGetById.mockResolvedValue({ ...pausedInstance, status: 'running' });

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('running');
  });

  it('[AUTH] returns 403 when user is not a member of the instance namespace', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });
    mockGetById.mockResolvedValue(claimedVerdictTask);
    mockInstanceGetById.mockResolvedValue(pausedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(403);
  });
});

// ---- Selection review resolution ----

describe('POST /api/tasks/:taskId/resolve — selection', () => {
  const selectionOptions = [
    { label: 'All-human', description: 'Every step by humans', value: { mode: 'human' } },
    { label: 'Hybrid', description: 'Agent + human review', value: { mode: 'hybrid' } },
    { label: 'Full-auto', description: 'Fully automated', value: { mode: 'auto' } },
  ];

  const claimedSelectionTask = {
    id: 'task-sel',
    processInstanceId: 'inst-1',
    stepId: 'review-configs',
    assignedRole: 'reviewer',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: undefined,
    selection: { min: 1, max: 3 },
    options: selectionOptions,
    createdAt: '2026-03-14T10:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedSelectionTask, status: 'completed' });
  });

  it('[DATA] resolves with selected option value as stepOutput', async () => {
    mockGetById.mockResolvedValue(claimedSelectionTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-sel', { verdict: 'approve', selectedIndex: 1 }),
      { params: makeParams('task-sel') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    // stepOutput should be the option's value + verdict
    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.mode).toBe('hybrid');
    expect(stepOutput.verdict).toBe('approve');

    // completionData should store selectedIndex and selectedOption
    const completionArg = mockComplete.mock.calls[0][1] as Record<string, unknown>;
    expect(completionArg.selectedIndex).toBe(1);
    expect(completionArg.selectedOption).toEqual(selectionOptions[1]);
    expect(completionArg.verdict).toBe('approve');
  });

  it('[DATA] revise works without selectedIndex', async () => {
    mockGetById.mockResolvedValue(claimedSelectionTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-sel', { verdict: 'revise', comment: 'Need more options' }),
      { params: makeParams('task-sel') },
    );

    expect(res.status).toBe(200);
    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.verdict).toBe('revise');
    expect(stepOutput.reviewerComment).toBe('Need more options');
  });

  it('[ERROR] returns 400 for out-of-range selectedIndex', async () => {
    mockGetById.mockResolvedValue(claimedSelectionTask);

    const res = await POST(
      makeRequest('task-sel', { verdict: 'approve', selectedIndex: 5 }),
      { params: makeParams('task-sel') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('out of range');
  });

  it('[ERROR] returns 400 for negative selectedIndex', async () => {
    mockGetById.mockResolvedValue(claimedSelectionTask);

    const res = await POST(
      makeRequest('task-sel', { verdict: 'approve', selectedIndex: -1 }),
      { params: makeParams('task-sel') },
    );

    expect(res.status).toBe(400);
  });
});

// ---- File upload resolution ----

describe('POST /api/tasks/:taskId/resolve — file-upload', () => {
  const claimedUploadTask = {
    id: 'task-2',
    processInstanceId: 'inst-1',
    stepId: 'upload-documents',
    assignedRole: 'operator',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: {
      component: 'file-upload',
      config: {
        acceptedTypes: ['application/pdf'],
        minFiles: 1,
        maxFiles: 5,
      },
    },
    createdAt: '2026-03-12T10:00:00Z',
    updatedAt: '2026-03-12T10:00:00Z',
  };

  const validAttachments = [
    {
      name: 'protocol.pdf',
      size: 102400,
      type: 'application/pdf',
      storagePath: 'tasks/task-2/abc_protocol.pdf',
      downloadUrl: 'https://storage.example.com/protocol.pdf',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedUploadTask, status: 'completed' });
  });

  it('[DATA] resolves a file-upload task with valid attachments', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-2', { attachments: validAttachments }),
      { params: makeParams('task-2') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.resolvedStepId).toBe('upload-documents');

    // completionData should contain files array
    const completionArg = mockComplete.mock.calls[0][1] as Record<string, unknown>;
    const files = completionArg.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('protocol.pdf');
    expect(files[0].uploadedAt).toBeDefined();

    // stepOutput to advanceStep should have files only (no task metadata)
    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.files).toBeDefined();
    expect(stepOutput.taskId).toBeUndefined();
  });

  it('[DATA] auto-claims pending upload task', async () => {
    const pendingUpload = { ...claimedUploadTask, status: 'pending', assignedUserId: null };
    const afterClaim = { ...claimedUploadTask, status: 'claimed', assignedUserId: 'api-user' };
    mockGetById.mockResolvedValue(pendingUpload);
    mockClaim.mockResolvedValue(afterClaim);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-2', { attachments: validAttachments }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith('task-2', 'api-user');
  });

  it('[ERROR] returns 400 when attachments missing', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', {}),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('attachments');
  });

  it('[ERROR] returns 400 when attachments is empty array', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', { attachments: [] }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
  });

  it('[ERROR] returns 400 when attachment has missing name', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', {
        attachments: [{ size: 100, type: 'application/pdf' }],
      }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('name');
  });

  it('[ERROR] returns 400 when too many files for maxFiles constraint', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const tooMany = Array.from({ length: 6 }, (_, index) => ({
      name: `file-${index}.pdf`,
      size: 1000,
      type: 'application/pdf',
    }));

    const res = await POST(
      makeRequest('task-2', { attachments: tooMany }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('1-5');
  });

  it('[ERROR] returns 400 when file type not accepted', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', {
        attachments: [{ name: 'data.csv', size: 100, type: 'text/csv' }],
      }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('text/csv');
  });

  it('[DATA] accepts extension-based types (e.g., .xpt)', async () => {
    const sdtmTask = {
      ...claimedUploadTask,
      stepId: 'upload-sdtm',
      ui: {
        component: 'file-upload',
        config: {
          acceptedTypes: ['.xpt', '.csv', 'application/octet-stream'],
          minFiles: 1,
          maxFiles: 50,
        },
      },
    };
    mockGetById.mockResolvedValue(sdtmTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-2', {
        attachments: [{ name: 'dm.xpt', size: 5000, type: 'application/octet-stream' }],
      }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(200);
  });

  it('[DATA] triggers auto-runner after resolution', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    await POST(
      makeRequest('task-2', { attachments: validAttachments }),
      { params: makeParams('task-2') },
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/processes/inst-1/run'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ---- Assignment table resolution ----

describe('POST /api/tasks/:taskId/resolve — assignment-table', () => {
  const claimedAssignmentTask = {
    id: 'task-3',
    processInstanceId: 'inst-1',
    stepId: 'assign',
    assignedRole: 'triager',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: {
      component: 'assignment-table',
      config: {
        assignees: [
          { id: 'filip', label: 'Filip', kind: 'human' },
          { id: 'fullstack-agent', label: 'Fullstack agent', kind: 'agent' },
        ],
      },
    },
    options: [
      { id: '101', label: '#101', raw: { issueNumber: 101 } },
      { id: '102', label: '#102', raw: { issueNumber: 102 } },
    ],
    createdAt: '2026-05-22T10:00:00Z',
    updatedAt: '2026-05-22T10:00:00Z',
  };

  const validAssignments = [
    {
      itemId: '101',
      assigneeId: 'filip',
      assigneeKind: 'human' as const,
      priority: 'P1',
      raw: { issueNumber: 101 },
    },
    {
      itemId: '102',
      assigneeId: 'fullstack-agent',
      assigneeKind: 'agent' as const,
      priority: 'P2',
      note: 'autonomous candidate',
      raw: { issueNumber: 102 },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedAssignmentTask, status: 'completed' });
  });

  it('[DATA] resolves an assignment-table task and passes assignments to advanceStep', async () => {
    mockGetById.mockResolvedValue(claimedAssignmentTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-3', { assignments: validAssignments }),
      { params: makeParams('task-3') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.assignments).toEqual(validAssignments);
    expect(stepOutput.verdict).toBeUndefined();
  });

  it('[DATA] completionData includes assignments plus actor metadata', async () => {
    mockGetById.mockResolvedValue(claimedAssignmentTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    await POST(
      makeRequest('task-3', { assignments: validAssignments }),
      { params: makeParams('task-3') },
    );

    const completionArg = mockComplete.mock.calls[0][1] as Record<string, unknown>;
    expect(completionArg.assignments).toEqual(validAssignments);
    expect(completionArg.completedBy).toBeDefined();
    expect(completionArg.completedAt).toBeDefined();
  });

  it('[ERROR] returns 400 when assignments missing', async () => {
    mockGetById.mockResolvedValue(claimedAssignmentTask);

    const res = await POST(
      makeRequest('task-3', {}),
      { params: makeParams('task-3') },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('assignments');
  });

  it('[ERROR] returns 400 when assignments is not an array', async () => {
    mockGetById.mockResolvedValue(claimedAssignmentTask);

    const res = await POST(
      makeRequest('task-3', { assignments: 'nope' }),
      { params: makeParams('task-3') },
    );

    expect(res.status).toBe(400);
  });

  it('[DATA] accepts empty assignments array (everything skipped)', async () => {
    mockGetById.mockResolvedValue(claimedAssignmentTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-3', { assignments: [] }),
      { params: makeParams('task-3') },
    );

    expect(res.status).toBe(200);
    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.assignments).toEqual([]);
  });
});

// ---- Table editor resolution ----

describe('POST /api/tasks/:taskId/resolve — table-editor', () => {
  const claimedTableEditorTask = {
    id: 'task-4',
    processInstanceId: 'inst-1',
    stepId: 'tag-issues',
    assignedRole: 'reviewer',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: {
      component: 'table-editor',
      config: {
        columns: [
          { id: 'issue', kind: 'static', label: 'Issue', field: 'label' },
          {
            id: 'category',
            kind: 'single-select',
            label: 'Category',
            allowEmpty: false,
            options: [{ id: 'ux', label: 'UX' }],
          },
        ],
      },
    },
    options: [
      { id: '101', label: '#101' },
      { id: '102', label: '#102' },
    ],
    createdAt: '2026-05-22T10:00:00Z',
    updatedAt: '2026-05-22T10:00:00Z',
  };

  const validRows = [
    { itemId: '101', values: { category: 'ux', priority: 'P1' } },
    { itemId: '102', values: { category: 'tech-debt', priority: 'P2' } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedTableEditorTask, status: 'completed' });
  });

  it('[DATA] resolves a table-editor task and passes rows to advanceStep', async () => {
    mockGetById.mockResolvedValue(claimedTableEditorTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-4', { rows: validRows }),
      { params: makeParams('task-4') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.rows).toEqual(validRows);
    expect(stepOutput.verdict).toBeUndefined();
  });

  it('[DATA] completionData includes rows plus actor metadata', async () => {
    mockGetById.mockResolvedValue(claimedTableEditorTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    await POST(
      makeRequest('task-4', { rows: validRows }),
      { params: makeParams('task-4') },
    );

    const completionArg = mockComplete.mock.calls[0][1] as Record<string, unknown>;
    expect(completionArg.rows).toEqual(validRows);
    expect(completionArg.completedBy).toBeDefined();
    expect(completionArg.completedAt).toBeDefined();
  });

  it('[ERROR] returns 400 when rows missing', async () => {
    mockGetById.mockResolvedValue(claimedTableEditorTask);

    const res = await POST(
      makeRequest('task-4', {}),
      { params: makeParams('task-4') },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('rows');
  });

  it('[ERROR] returns 400 when rows is not an array', async () => {
    mockGetById.mockResolvedValue(claimedTableEditorTask);

    const res = await POST(
      makeRequest('task-4', { rows: 'nope' }),
      { params: makeParams('task-4') },
    );

    expect(res.status).toBe(400);
  });
});
