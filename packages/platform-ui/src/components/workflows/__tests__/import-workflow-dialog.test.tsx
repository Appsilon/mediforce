import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mediforce } from '@/lib/mediforce';
import { ImportWorkflowDialog } from '../import-workflow-dialog';

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    workflows: {
      getManifest: vi.fn(),
      importFromRepo: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const getManifestMock = vi.mocked(mediforce.workflows.getManifest);
const importFromRepoMock = vi.mocked(mediforce.workflows.importFromRepo);

const MANIFEST = {
  workflows: [
    {
      name: 'tutorial-linear-pipeline',
      path: 'docs/workflow-examples/01-linear-pipeline.wd.json',
      description: 'Human fills a form, a script processes it, done.',
      tags: ['tutorial', 'pipeline'],
    },
    {
      name: 'tutorial-review-loop',
      path: 'docs/workflow-examples/02-review-loop.wd.json',
      description: 'Agent generates content, human reviews it.',
      tags: ['tutorial', 'review'],
    },
  ],
};

describe('ImportWorkflowDialog', () => {
  beforeEach(() => {
    getManifestMock.mockReset();
    importFromRepoMock.mockReset();
    getManifestMock.mockResolvedValue(MANIFEST as never);
    importFromRepoMock.mockResolvedValue({} as never);
  });

  // Spelled out rather than compared against the exported constant: importing
  // DEFAULT_REPO from the component under test asserts nothing, so the default
  // could revert to a tree URL — the shape whose ref and directory have to be
  // guessed apart — with the test still green.
  it('defaults to the Mediforce repository URL', () => {
    render(
      <ImportWorkflowDialog
        namespace="test"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Repository URL')).toHaveValue(
      'https://github.com/Appsilon/mediforce',
    );
  });

  it('offers import-by-path when a repository has no manifest to browse', async () => {
    const user = userEvent.setup();
    getManifestMock.mockRejectedValue(new Error('Manifest not found.'));
    render(<ImportWorkflowDialog namespace="test" open={true} onOpenChange={vi.fn()} />);

    // Two controls read "Browse": the mode toggle and the submit button, in that
    // order. The submit button is the one that fetches.
    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    await user.click(browseButtons[browseButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByLabelText('Path to .wd.json')).toBeInTheDocument();
    });
    expect(screen.getByText(/Add a workflows-index.json to enable browsing/)).toBeInTheDocument();
  });

  describe('examples entry', () => {
    it('browses the Mediforce examples on open without asking for a repository', async () => {
      render(
        <ImportWorkflowDialog
          namespace="test"
          entry="examples"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('tutorial-linear-pipeline')).toBeInTheDocument();
      });
      expect(getManifestMock).toHaveBeenCalledWith({
        repo: 'https://github.com/Appsilon/mediforce',
        ref: undefined,
      });
      expect(screen.queryByLabelText('Repository URL')).not.toBeInTheDocument();
    });

    it('imports every picked example into the namespace', async () => {
      const user = userEvent.setup();
      const onImported = vi.fn();
      render(
        <ImportWorkflowDialog
          namespace="test"
          entry="examples"
          open={true}
          onOpenChange={vi.fn()}
          onImported={onImported}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('tutorial-review-loop')).toBeInTheDocument();
      });
      await user.click(screen.getByText('tutorial-review-loop'));
      await user.click(screen.getByRole('button', { name: 'Import selected' }));

      await waitFor(() => {
        expect(onImported).toHaveBeenCalled();
      });
      expect(importFromRepoMock).toHaveBeenCalledTimes(1);
      expect(importFromRepoMock).toHaveBeenCalledWith({
        repo: 'https://github.com/Appsilon/mediforce',
        path: 'docs/workflow-examples/02-review-loop.wd.json',
        ref: undefined,
        namespace: 'test',
      });
    });

    it('falls back to the repository form when the examples cannot be fetched', async () => {
      const user = userEvent.setup();
      getManifestMock.mockRejectedValue(new Error('offline'));
      render(
        <ImportWorkflowDialog
          namespace="test"
          entry="examples"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/offline/)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /another repository/i }));

      expect(screen.getByLabelText('Repository URL')).toHaveValue(
        'https://github.com/Appsilon/mediforce',
      );
    });
  });
});
