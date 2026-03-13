import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';

// Mock Firebase — must come before any component imports
vi.mock('@/lib/firebase', () => ({
  db: {},
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

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn(),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock hooks
vi.mock('@/hooks/use-collection', () => ({
  useCollection: () => ({ data: [], loading: false }),
}));

// Mock server actions
const mockCompleteUploadTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/app/actions/upload-task', () => ({
  completeUploadTask: (...args: unknown[]) => mockCompleteUploadTask(...args),
}));

// Mock completeTask (imported by verdict-form)
vi.mock('@/app/actions/tasks', () => ({
  completeTask: vi.fn().mockResolvedValue({ success: true }),
  claimTask: vi.fn().mockResolvedValue({ success: true }),
  unclaimTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { TaskDetail } from '../task-detail';

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

describe('TaskDetail — file upload integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] shows FileUploadZone when task has ui.component file-upload', () => {
    const task = createUploadTask();

    render(<TaskDetail task={task} currentUserId="user-1" />);

    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/pdf/i)).toBeInTheDocument();
  });

  it('[RENDER] does not show FileUploadZone for regular review tasks', () => {
    const task = buildHumanTask({
      status: 'claimed',
      assignedUserId: 'user-1',
    });

    render(<TaskDetail task={task} currentUserId="user-1" />);

    expect(screen.queryByText(/drop files here/i)).not.toBeInTheDocument();
    // Should show verdict form instead
    expect(screen.getByText(/approve/i)).toBeInTheDocument();
  });

  it('[RENDER] does not show FileUploadZone when task is pending', () => {
    const task = createUploadTask({ status: 'pending', assignedUserId: null });

    render(<TaskDetail task={task} currentUserId="user-1" />);

    // Should show claim button, not upload zone
    expect(screen.queryByText(/drop files here/i)).not.toBeInTheDocument();
  });

  it('[RENDER] does not show verdict form when upload UI is active', () => {
    const task = createUploadTask();

    render(<TaskDetail task={task} currentUserId="user-1" />);

    // Should show upload zone, not verdict buttons
    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.queryByText(/revise/i)).not.toBeInTheDocument();
  });

  it('[CLICK] calls completeUploadTask when files are submitted', async () => {
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<TaskDetail task={task} currentUserId="user-1" />);

    // Add a file
    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    // Submit
    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(mockCompleteUploadTask).toHaveBeenCalledTimes(1);
    expect(mockCompleteUploadTask).toHaveBeenCalledWith(
      task.id,
      [expect.objectContaining({ name: 'protocol.pdf', downloadUrl: 'https://storage.example.com/file.pdf' })],
    );
  });

  it('[RENDER] shows completion state after successful upload', async () => {
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<TaskDetail task={task} currentUserId="user-1" />);

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
          { name: 'protocol.pdf', size: 102400, type: 'application/pdf', storagePath: 'tasks/t/a.pdf', downloadUrl: 'https://storage.example.com/protocol.pdf', uploadedAt: '2026-03-10T12:00:00.000Z' },
          { name: 'appendix.pdf', size: 51200, type: 'application/pdf', storagePath: 'tasks/t/b.pdf', downloadUrl: 'https://storage.example.com/appendix.pdf', uploadedAt: '2026-03-10T12:00:00.000Z' },
        ],
        completedAt: '2026-03-10T12:00:00.000Z',
      },
    });

    render(<TaskDetail task={task} currentUserId="user-1" />);

    expect(screen.getByText(/2 files uploaded/i)).toBeInTheDocument();
    expect(screen.getByText('protocol.pdf')).toBeInTheDocument();
    expect(screen.getByText('appendix.pdf')).toBeInTheDocument();
    expect(screen.getByText(/100(.0)?\s*KB/i)).toBeInTheDocument();

    // Download links present
    const downloadLinks = screen.getAllByRole('link', { name: /download/i });
    expect(downloadLinks).toHaveLength(2);
    expect(downloadLinks[0]).toHaveAttribute('href', 'https://storage.example.com/protocol.pdf');
  });

  it('[ERROR] shows error when upload fails', async () => {
    mockCompleteUploadTask.mockResolvedValueOnce({ success: false, error: 'Storage error' });
    const user = userEvent.setup();
    const task = createUploadTask();

    render(<TaskDetail task={task} currentUserId="user-1" />);

    const input = screen.getByTestId('file-input');
    const file = new File(['content'], 'protocol.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await user.click(uploadButton);

    expect(await screen.findByText(/storage error/i)).toBeInTheDocument();
  });
});
