import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';

const mockRunOutputFiles = vi.fn();
vi.mock('@/hooks/use-run-output-files', () => ({
  useRunOutputFiles: (...args: unknown[]) => mockRunOutputFiles(...args),
}));

const mockDownloadOutputFile = vi.fn();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { runs: { downloadOutputFile: (...args: unknown[]) => mockDownloadOutputFile(...args) } },
}));

const mockSaveBlobToDevice = vi.fn();
vi.mock('@/lib/save-blob', () => ({
  saveBlobToDevice: (...args: unknown[]) => mockSaveBlobToDevice(...args),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import { StepOutputViewer } from '../step-output-viewer';

function outputFile(stepId: string, name: string, size = 64): RunOutputFileEntry {
  return { stepId, name, path: `.mediforce/output/${stepId}/${name}`, size };
}

function serveFile(contents: string, contentType: string): void {
  mockDownloadOutputFile.mockResolvedValue({
    fileName: 'file',
    contentType,
    bytes: new TextEncoder().encode(contents),
  });
}

const RESULT = { ctcaeGrade: 3, confidence_note: 'checked' };

describe('StepOutputViewer', () => {
  beforeEach(() => {
    mockRunOutputFiles.mockReset();
    mockDownloadOutputFile.mockReset();
    mockSaveBlobToDevice.mockReset();
  });

  it('opens on result.json, rendering the step result as JSON', () => {
    mockRunOutputFiles.mockReturnValue({ data: [outputFile('grade', 'listing.csv')], loading: false, error: null });

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);

    expect(screen.getByRole('combobox', { name: 'Step output file' })).toHaveValue('result.json');
    expect(screen.getByTestId('step-result-json').textContent).toBe(JSON.stringify(RESULT, null, 2));
    expect(mockDownloadOutputFile).not.toHaveBeenCalled();
  });

  it('lists only this step\'s Output Files after result.json, never result.json twice', () => {
    mockRunOutputFiles.mockReturnValue({
      data: [
        outputFile('grade', 'summary.md'),
        outputFile('extract', 'raw.csv'),
        outputFile('grade', 'result.json'),
        outputFile('grade', 'listing.csv'),
      ],
      loading: false,
      error: null,
    });

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);

    const options = within(screen.getByRole('combobox', { name: 'Step output file' }))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['result.json', 'listing.csv (64 B)', 'summary.md (64 B)']);
  });

  it('renders a picked markdown file with the markdown viewer', async () => {
    mockRunOutputFiles.mockReturnValue({ data: [outputFile('grade', 'summary.md')], loading: false, error: null });
    serveFile('# Grade Summary\n\nTwo grade 3 events.\n', 'text/markdown');

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);
    await userEvent.setup().selectOptions(
      screen.getByRole('combobox', { name: 'Step output file' }),
      '.mediforce/output/grade/summary.md',
    );

    expect(await screen.findByRole('heading', { name: 'Grade Summary' })).toBeInTheDocument();
    expect(mockDownloadOutputFile).toHaveBeenCalledWith({ runId: 'run-1', path: '.mediforce/output/grade/summary.md' });
    expect(screen.queryByTestId('step-result-json')).not.toBeInTheDocument();
  });

  it('renders a picked CSV file as a table', async () => {
    mockRunOutputFiles.mockReturnValue({ data: [outputFile('grade', 'listing.csv')], loading: false, error: null });
    serveFile('subject,grade\nS-001,3\n', 'text/csv');

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);
    await userEvent.setup().selectOptions(
      screen.getByRole('combobox', { name: 'Step output file' }),
      '.mediforce/output/grade/listing.csv',
    );

    expect(await screen.findByRole('columnheader', { name: 'subject' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'S-001' })).toBeInTheDocument();
  });

  it('exposes the step result to a picked HTML file as window.__data__', async () => {
    mockRunOutputFiles.mockReturnValue({ data: [outputFile('grade', 'presentation.html')], loading: false, error: null });
    serveFile('<p>Report</p>', 'text/html');

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);
    await userEvent.setup().selectOptions(
      screen.getByRole('combobox', { name: 'Step output file' }),
      '.mediforce/output/grade/presentation.html',
    );

    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('<p>Report</p>');
    expect(srcdoc).toContain('"ctcaeGrade":3');
  });

  it('shows only result.json for a run that committed no files (old runs)', () => {
    mockRunOutputFiles.mockReturnValue({ data: [], loading: false, error: null });

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);

    expect(within(screen.getByRole('combobox', { name: 'Step output file' })).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByTestId('step-result-json')).toBeInTheDocument();
  });

  it('does not ask for files when there is no run branch', () => {
    mockRunOutputFiles.mockReturnValue({ data: [], loading: false, error: null });

    render(<StepOutputViewer result={RESULT} runId={null} stepId="grade" runStatus={undefined} />);

    expect(mockRunOutputFiles).toHaveBeenCalledWith(null, undefined);
    expect(screen.getByTestId('step-result-json')).toBeInTheDocument();
  });

  it('downloads result.json from the step result', async () => {
    mockRunOutputFiles.mockReturnValue({ data: [], loading: false, error: null });

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /download/i }));

    expect(mockSaveBlobToDevice).toHaveBeenCalledTimes(1);
    const [blob, fileName] = mockSaveBlobToDevice.mock.calls[0] as [Blob, string];
    expect(fileName).toBe('result.json');
    expect(JSON.parse(await blob.text())).toEqual(RESULT);
  });

  it('downloads the picked Output File from the run branch', async () => {
    mockRunOutputFiles.mockReturnValue({ data: [outputFile('grade', 'listing.csv')], loading: false, error: null });
    serveFile('subject,grade\nS-001,3\n', 'text/csv');

    render(<StepOutputViewer result={RESULT} runId="run-1" stepId="grade" runStatus="completed" />);
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Step output file' }),
      '.mediforce/output/grade/listing.csv',
    );
    await user.click(screen.getByRole('button', { name: /download/i }));

    await waitFor(() => expect(mockSaveBlobToDevice).toHaveBeenCalledTimes(1));
    expect(mockSaveBlobToDevice.mock.calls[0][1]).toBe('file');
  });
});
