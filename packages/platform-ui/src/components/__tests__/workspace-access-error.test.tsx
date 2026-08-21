import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceAccessError } from '../workspace-access-error';

describe('WorkspaceAccessError', () => {
  it('explains the unavailable workspace and offers a safe next step', () => {
    render(<WorkspaceAccessError handle="private-workspace" />);

    expect(screen.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    expect(screen.getByText(/may not have access to this workspace/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /choose another workspace/i })).toHaveAttribute(
      'href',
      '/workspace-selection',
    );
  });
});
