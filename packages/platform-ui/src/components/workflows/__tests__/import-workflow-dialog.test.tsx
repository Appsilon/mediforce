import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_REPO, ImportWorkflowDialog } from '../import-workflow-dialog';

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    workflows: {
      getManifest: vi.fn(),
      importFromRepo: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

describe('ImportWorkflowDialog', () => {
  it('defaults to the current workflow examples source', () => {
    render(
      <ImportWorkflowDialog
        namespace="test"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Repository URL')).toHaveValue(DEFAULT_REPO);
    expect(screen.getByText(/defaults to the source URL ref, or main/i)).toBeInTheDocument();
  });
});
