import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUploadZone } from '../file-upload-zone';

function createMockFile(
  name: string,
  size: number,
  type: string,
): File {
  const file = new File(['x'.repeat(size)], name, { type });
  return file;
}

describe('FileUploadZone', () => {
  const defaultProps = {
    acceptedTypes: ['application/pdf'],
    minFiles: 1,
    maxFiles: 5,
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] renders drop zone with accepted types', () => {
    render(<FileUploadZone {...defaultProps} />);

    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/pdf/i)).toBeInTheDocument();
  });

  it('[RENDER] shows file count constraints', () => {
    render(<FileUploadZone {...defaultProps} minFiles={2} maxFiles={10} />);

    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('[RENDER] shows selected files in list', async () => {
    render(<FileUploadZone {...defaultProps} />);

    const input = screen.getByTestId('file-input');
    const file = createMockFile('report.pdf', 1024, 'application/pdf');

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('[RENDER] shows formatted file size', async () => {
    render(<FileUploadZone {...defaultProps} />);

    const input = screen.getByTestId('file-input');
    const file = createMockFile('big.pdf', 1048576, 'application/pdf');

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/^1(.0)?\s*MB$/i)).toBeInTheDocument();
  });

  it('[ERROR] rejects file with invalid MIME type', async () => {
    render(<FileUploadZone {...defaultProps} acceptedTypes={['application/pdf']} />);

    const input = screen.getByTestId('file-input');
    const file = createMockFile('image.png', 1024, 'image/png');

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/not accepted/i)).toBeInTheDocument();
    expect(screen.queryByText('image.png')).not.toBeInTheDocument();
  });

  it('[ERROR] prevents adding more files than maxFiles', async () => {
    render(<FileUploadZone {...defaultProps} maxFiles={2} />);

    const input = screen.getByTestId('file-input');
    const files = [
      createMockFile('a.pdf', 100, 'application/pdf'),
      createMockFile('b.pdf', 100, 'application/pdf'),
      createMockFile('c.pdf', 100, 'application/pdf'),
    ];

    fireEvent.change(input, { target: { files } });

    expect(screen.getByText(/maximum.*2/i)).toBeInTheDocument();
  });

  it('[ERROR] shows error when submitting fewer files than minFiles', async () => {
    const user = userEvent.setup();
    render(<FileUploadZone {...defaultProps} minFiles={2} />);

    const input = screen.getByTestId('file-input');
    const file = createMockFile('a.pdf', 100, 'application/pdf');
    fireEvent.change(input, { target: { files: [file] } });

    const submitButton = screen.getByRole('button', { name: /upload/i });
    await user.click(submitButton);

    expect(screen.getByText(/at least 2/i)).toBeInTheDocument();
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it('[CLICK] calls onSubmit with files when valid', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<FileUploadZone {...defaultProps} minFiles={1} onSubmit={onSubmit} />);

    const input = screen.getByTestId('file-input');
    const file = createMockFile('report.pdf', 2048, 'application/pdf');
    fireEvent.change(input, { target: { files: [file] } });

    const submitButton = screen.getByRole('button', { name: /upload/i });
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([file]);
  });

  it('[CLICK] removes file when remove button is clicked', async () => {
    const user = userEvent.setup();
    render(<FileUploadZone {...defaultProps} />);

    const input = screen.getByTestId('file-input');
    const file = createMockFile('report.pdf', 1024, 'application/pdf');
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('report.pdf')).toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: /remove/i });
    await user.click(removeButton);

    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument();
  });

  it('[RENDER] disables submit button when no files selected', () => {
    render(<FileUploadZone {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /upload/i });
    expect(submitButton).toBeDisabled();
  });

  it('[CLICK] allows adding files incrementally', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<FileUploadZone {...defaultProps} maxFiles={3} onSubmit={onSubmit} />);

    const input = screen.getByTestId('file-input');

    // Add first file
    const file1 = createMockFile('a.pdf', 100, 'application/pdf');
    fireEvent.change(input, { target: { files: [file1] } });
    expect(screen.getByText('a.pdf')).toBeInTheDocument();

    // Add second file
    const file2 = createMockFile('b.pdf', 200, 'application/pdf');
    fireEvent.change(input, { target: { files: [file2] } });
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('b.pdf')).toBeInTheDocument();

    // Submit both
    const submitButton = screen.getByRole('button', { name: /upload/i });
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith([file1, file2]);
  });
});
