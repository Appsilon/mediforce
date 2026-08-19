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

  it('[RENDER] asks for a version name without explaining the verification pipeline', () => {
    render(<SaveVersionDialog open nextVersion={2} onClose={noop} onConfirm={vi.fn()} />);

    // Naming a version is the only decision here; the four-rung ladder was
    // internal vocabulary in the way of a text field (#1233).
    expect(screen.queryByText('Dry Run')).not.toBeInTheDocument();
    expect(screen.queryByText('Schema validation')).not.toBeInTheDocument();
    expect(screen.queryByText('Workflow readiness check')).not.toBeInTheDocument();
  });
});
