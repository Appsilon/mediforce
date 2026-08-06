import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('ImportWorkflowDialog', () => {
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
});
