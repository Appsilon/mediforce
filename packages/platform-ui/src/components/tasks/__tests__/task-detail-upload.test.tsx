import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

function render(ui: React.ReactElement) {
  const { wrapper } = createQueryWrapper();
  return rtlRender(ui, { wrapper });
}

// Firebase Storage is gone (ADR-0003); only Auth init survives in @/lib/firebase.
vi.mock('@/lib/firebase', () => ({
  auth: {},
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ firebaseUser: { getIdToken: vi.fn().mockResolvedValue('mock-id-token') } }),
}));

// Authenticated blob download — fired on click, stubbed so no real fetch runs.
vi.mock('@/lib/save-blob', () => ({
  downloadViaApiFetch: vi.fn(async () => undefined),
  saveBlobToDevice: vi.fn(),
}));

// Mock typed mediforce client — attachments upload/list + complete.
vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    tasks: {
      complete: vi.fn(async () => ({ task: {}, run: {} })),
      list: vi.fn(async () => ({ tasks: [] })),
      attachments: {
        upload: vi.fn(async (input: { name: string; contentType: string }) => ({
          attachment: {
            id: 'att-1',
            taskId: 'task-1',
            workspace: 'demo',
            name: input.name,
            contentType: input.contentType,
            sizeBytes: 7,
            blobKey: 'blob/att-1',
            uploadedBy: 'user-1',
            uploadedAt: '2026-03-10T12:00:00.000Z',
            deletedAt: null,
          },
        })),
        list: vi.fn(async () => ({ attachments: [] })),
      },
    },
    attachments: {
      blobUrl: (id: string) => `/api/attachments/${id}/blob`,
    },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { mediforce } from '@/lib/mediforce';
import { FileUploadView } from '../file-upload-view';
import { FileUploadZone } from '../file-upload-zone';
import { SelectionView } from '../selection-view';

const completeMock = vi.mocked(mediforce.tasks.complete);
const uploadMock = vi.mocked(mediforce.tasks.attachments.upload);
const listMock = vi.mocked(mediforce.tasks.attachments.list);

function createUploadTask(overrides?: Partial<HumanTask>): HumanTask {
  return buildHumanTask({
    status: 'claimed',
    assignedUserId: 'user-1',
    ui: {
      component: 'file-upload',
      config: {
        acceptedTypes: ['application/pdf'],
        minFiles: 1,
        maxFiles: 5,
      },
    },
    ...overrides,
  });
}

// ---- Selection task rendering ----

function createSelectionTask(overrides?: Partial<HumanTask>): HumanTask {
  return buildHumanTask({
    status: 'claimed',
    assignedUserId: 'user-1',
    options: [
      { label: 'All-human', description: 'Every step by humans', value: { mode: 'human' } },
      { label: 'Hybrid', description: 'Agent + human review', value: { mode: 'hybrid' } },
    ],
    selection: { min: 1, max: 2 },
    ...overrides,
  });
}

describe('SelectionView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] shows option cards when task has options', () => {
    const task = createSelectionTask();
    render(<SelectionView task={task} />);

    expect(screen.getByText('All-human')).toBeInTheDocument();
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    expect(screen.getByText(/every step by humans/i)).toBeInTheDocument();
  });

  it('[RENDER] shows approve and revise buttons for selection tasks', () => {
    const task = createSelectionTask();
    render(<SelectionView task={task} />);

    expect(screen.getByRole('button', { name: /approve selected/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument();
  });

  it('[RENDER] does not show regular verdict form for selection tasks', () => {
    const task = createSelectionTask();
    render(<SelectionView task={task} />);

    // SelectionView shows "Approve selected", not a bare "Approve" button
    const approveButtons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.trim() === 'Approve',
    );
    expect(approveButtons).toHaveLength(0);
  });

  it('[RENDER] shows selection form even when task is pending (auto-assign)', () => {
    const task = createSelectionTask({ status: 'pending', assignedUserId: null });
    render(<SelectionView task={task} />);

    expect(screen.getByText('All-human')).toBeInTheDocument();
  });

  it('[RENDER] shows completed state for selection task', () => {
    const task = createSelectionTask({
      status: 'completed',
      completedAt: '2026-03-14T12:00:00.000Z',
      completionData: {
        verdict: 'approve',
        selectedIndex: 0,
        selectedOption: { label: 'All-human', description: 'Every step by humans', value: { mode: 'human' } },
        completedBy: 'user-1',
        completedAt: '2026-03-14T12:00:00.000Z',
      },
    });
    render(<SelectionView task={task} />);

    expect(screen.getByText(/you approved: all-human/i)).toBeInTheDocument();
  });
});

// ---- File upload rendering ----

describe('FileUploadView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] shows FileUploadZone when task has ui.component file-upload', () => {
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/pdf/i)).toBeInTheDocument();
  });

  it('[RENDER] shows the 100 MB size limit hint', () => {
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    expect(screen.getByText(/max 100 MB each/i)).toBeInTheDocument();
  });

  it('[RENDER] shows FileUploadZone even when task is pending (auto-assign)', () => {
    const task = createUploadTask({ status: 'pending', assignedUserId: null });

    render(<FileUploadView task={task} />);

    // Forms are shown for pending tasks (claiming removed, auto-assign enabled)
    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
  });

  it('[RENDER] does not show verdict buttons when upload UI is active', () => {
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.queryByText(/revise/i)).not.toBeInTheDocument();
  });

  it('[CLICK] uploads bytes via the attachments API then completes the task with blob descriptors', async () => {
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.id, name: 'protocol.pdf', contentType: 'application/pdf' }),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledWith({
      taskId: task.id,
      payload: {
        kind: 'upload',
        attachments: [
          {
            name: 'protocol.pdf',
            size: 7,
            type: 'application/pdf',
            storagePath: 'att-1',
            downloadUrl: '/api/attachments/att-1/blob',
          },
        ],
      },
    });
  });

  it('[RENDER] shows completion state after successful upload', async () => {
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(await screen.findByText(/uploaded/i)).toBeInTheDocument();
  });

  it('[RENDER] lists uploaded files from the attachments API in a completed task', async () => {
    listMock.mockResolvedValueOnce({
      attachments: [
        {
          id: 'att-a', taskId: 'task-1', workspace: 'demo', name: 'protocol.pdf',
          contentType: 'application/pdf', sizeBytes: 102400, blobKey: 'blob/a',
          uploadedBy: 'user-1', uploadedAt: '2026-03-10T12:00:00.000Z', deletedAt: null,
        },
        {
          id: 'att-b', taskId: 'task-1', workspace: 'demo', name: 'appendix.pdf',
          contentType: 'application/pdf', sizeBytes: 51200, blobKey: 'blob/b',
          uploadedBy: 'user-1', uploadedAt: '2026-03-10T12:00:00.000Z', deletedAt: null,
        },
      ],
    });
    const task = createUploadTask({
      status: 'completed',
      completedAt: '2026-03-10T12:00:00.000Z',
      completionData: { completedAt: '2026-03-10T12:00:00.000Z' },
    });

    render(<FileUploadView task={task} />);

    expect(await screen.findByText('protocol.pdf')).toBeInTheDocument();
    expect(screen.getByText('appendix.pdf')).toBeInTheDocument();
    expect(screen.getByText(/2 files uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/100(.0)?\s*KB/i)).toBeInTheDocument();

    const downloadButtons = screen.getAllByRole('button', { name: /download/i });
    expect(downloadButtons).toHaveLength(2);
  });

  it('[ERROR] shows error when upload fails', async () => {
    uploadMock.mockRejectedValueOnce(new Error('Upload failed'));
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(await screen.findByText(/upload failed/i)).toBeInTheDocument();
  });
});

// ---- Over-limit guard (FileUploadZone) ----

describe('FileUploadZone over-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[ERROR] rejects a file larger than the size limit with a friendly message', () => {
    const onSubmit = vi.fn();
    render(
      <FileUploadZone
        acceptedTypes={['application/pdf']}
        minFiles={1}
        maxFiles={5}
        maxFileSizeMB={1}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByTestId('file-input');
    const bigFile = new File([new Uint8Array(2 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(screen.getByText(/too large \(max 1 MB\)/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
