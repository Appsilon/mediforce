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

// Mock Firebase — must come before any component imports
vi.mock('@/lib/firebase', () => ({
  auth: {},
  storage: {},
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytesResumable: vi.fn().mockImplementation(() => {
    const task = {
      snapshot: { ref: {} },
      on: (_event: string, _progress: unknown, _error: unknown, complete: () => void) => {
        // Immediately complete the upload
        complete();
      },
    };
    return task;
  }),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.example.com/file.pdf'),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ firebaseUser: { getIdToken: vi.fn().mockResolvedValue('mock-id-token') } }),
}));

// Mock typed mediforce client
vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    tasks: {
      complete: vi.fn(async () => ({ task: {}, run: {} })),
      list: vi.fn(async () => ({ tasks: [] })),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { mediforce } from '@/lib/mediforce';
import { FileUploadView } from '../file-upload-view';
import { SelectionView } from '../selection-view';

const completeMock = vi.mocked(mediforce.tasks.complete);

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
    const approveButtons = screen.getAllByRole('button').filter((btn) => btn.textContent?.trim() === 'Approve');
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

  it('[CLICK] calls completeUploadTask when files are submitted', async () => {
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledWith({
      taskId: task.id,
      payload: {
        kind: 'upload',
        attachments: [
          expect.objectContaining({ name: 'protocol.pdf', downloadUrl: 'https://storage.example.com/file.pdf' }),
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

  it('[RENDER] shows uploaded files with download links in completed upload task', () => {
    const task = createUploadTask({
      status: 'completed',
      completedAt: '2026-03-10T12:00:00.000Z',
      completionData: {
        files: [
          {
            name: 'protocol.pdf',
            size: 102400,
            type: 'application/pdf',
            storagePath: 'tasks/t/a.pdf',
            downloadUrl: 'https://storage.example.com/protocol.pdf',
            uploadedAt: '2026-03-10T12:00:00.000Z',
          },
          {
            name: 'appendix.pdf',
            size: 51200,
            type: 'application/pdf',
            storagePath: 'tasks/t/b.pdf',
            downloadUrl: 'https://storage.example.com/appendix.pdf',
            uploadedAt: '2026-03-10T12:00:00.000Z',
          },
        ],
        completedAt: '2026-03-10T12:00:00.000Z',
      },
    });

    render(<FileUploadView task={task} />);

    expect(screen.getByText(/2 files uploaded/i)).toBeInTheDocument();
    expect(screen.getByText('protocol.pdf')).toBeInTheDocument();
    expect(screen.getByText('appendix.pdf')).toBeInTheDocument();
    expect(screen.getByText(/100(.0)?\s*KB/i)).toBeInTheDocument();

    const downloadLinks = screen.getAllByRole('link', { name: /download/i });
    expect(downloadLinks).toHaveLength(2);
    expect(downloadLinks[0]).toHaveAttribute('href', 'https://storage.example.com/protocol.pdf');
  });

  it('[ERROR] shows error when upload fails', async () => {
    completeMock.mockRejectedValueOnce(new Error('Storage error'));
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<FileUploadView task={task} />);

    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(await screen.findByText(/storage error/i)).toBeInTheDocument();
  });
});
