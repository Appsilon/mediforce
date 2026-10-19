import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockDownloadOutputFile = vi.fn();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { runs: { downloadOutputFile: (...args: unknown[]) => mockDownloadOutputFile(...args) } },
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import { OutputFileRow } from '../run-output-files-panel';

describe('OutputFileRow', () => {
  it('exposes the step result to a previewed HTML file as window.__data__', async () => {
    mockDownloadOutputFile.mockResolvedValue({
      fileName: 'presentation.html',
      contentType: 'text/html',
      bytes: new TextEncoder().encode('<p>Rejection note</p>'),
    });
    const file = {
      stepId: 'draft-rejection-note',
      name: 'presentation.html',
      path: '.mediforce/output/draft-rejection-note/presentation.html',
      size: 64,
    };

    render(<OutputFileRow runId="run-1" file={file} result={{ reason: 'missing SDTM domain' }} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('<p>Rejection note</p>');
    expect(srcdoc).toContain('"reason":"missing SDTM domain"');
  });
});
