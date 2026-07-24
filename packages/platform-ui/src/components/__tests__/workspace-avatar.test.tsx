import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceAvatar } from '../workspace-avatar';

const fallback = <span data-testid="fallback">fallback</span>;

describe('WorkspaceAvatar', () => {
  it('renders the image when a source is present', () => {
    render(<WorkspaceAvatar source="data:image/png;base64,iVBORw0KGgo=" alt="Acme" className="h-4 w-4" fallback={fallback} />);
    expect(screen.getByAltText('Acme')).toBeInTheDocument();
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it.each([undefined, null, ''])('renders the fallback when the source is %p', (source) => {
    render(<WorkspaceAvatar source={source} alt="Acme" className="h-4 w-4" fallback={fallback} />);
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('swaps to the fallback when the image fails to load', () => {
    render(<WorkspaceAvatar source="data:image/png;base64,corrupt" alt="Acme" className="h-4 w-4" fallback={fallback} />);
    fireEvent.error(screen.getByAltText('Acme'));
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByAltText('Acme')).toBeNull();
  });

  it('retries the image after the source changes', () => {
    const { rerender } = render(
      <WorkspaceAvatar source="data:image/png;base64,corrupt" alt="Acme" className="h-4 w-4" fallback={fallback} />,
    );
    fireEvent.error(screen.getByAltText('Acme'));
    rerender(
      <WorkspaceAvatar source="data:image/png;base64,iVBORw0KGgo=" alt="Acme" className="h-4 w-4" fallback={fallback} />,
    );
    expect(screen.getByAltText('Acme')).toBeInTheDocument();
  });
});
