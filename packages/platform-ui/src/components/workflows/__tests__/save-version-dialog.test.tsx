import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SaveVersionDialog } from '../save-version-dialog';

const noop = () => {};

describe('SaveVersionDialog', () => {
  it('[RENDER] renders nothing while closed', () => {
    const { container } = render(
      <SaveVersionDialog open={false} nextVersion={2} onClose={noop} onConfirm={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('[RENDER] shows the verification ladder so saving points at the next check', () => {
    render(<SaveVersionDialog open nextVersion={2} onClose={noop} onConfirm={vi.fn()} />);

    // Saving is rung 1 — schema validation runs on every save.
    expect(screen.getByTestId('rung-schema')).toHaveAttribute('data-state', 'current');
    expect(screen.getByText('Dry Run')).toBeInTheDocument();
    expect(screen.getByText('Is the workflow structured as I intended?')).toBeInTheDocument();
  });
});
