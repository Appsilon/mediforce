import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ handle: 'acme' }) }));

import { AuthoringPathsPopover } from '../authoring-paths-popover';
import { AUTHORING_PATHS } from '@/lib/authoring-paths';

function openPopover(): void {
  render(<AuthoringPathsPopover />);
  fireEvent.click(screen.getByRole('button', { name: /ways to author/i }));
}

describe('AuthoringPathsPopover (#1185)', () => {
  it('names every authoring path and states a reason to pick it', () => {
    openPopover();

    for (const path of AUTHORING_PATHS) {
      const entry = screen.getByTestId(`authoring-path-${path.id}`);
      expect(entry).toHaveTextContent(path.label);
      expect(entry).toHaveTextContent(path.reason);
    }
  });

  it('covers the path that lives outside the browser', () => {
    openPopover();

    // Import is the one a user cannot discover by clicking around the canvas.
    expect(screen.getByTestId('authoring-path-import')).toHaveTextContent(/git/i);
  });

  it('sends nobody to a checkout for what the app can do', () => {
    // The `/design-workflow` skill was listed while the canvas could not author
    // scripts, a Dockerfile or skills. A workflow carries its own files now, so
    // naming it here would send people out of the app for a capability that is
    // in it — and the assistant entry has to say it writes those files.
    openPopover();

    expect(screen.queryByTestId('authoring-path-agent')).toBeNull();
    expect(document.body.textContent).not.toContain('/design-workflow');
    expect(document.body.textContent).not.toContain('git clone');
    expect(screen.getByTestId('authoring-path-assistant')).toHaveTextContent(/a script, a Dockerfile, a skill/);
  });

  it('states how to start every path it names', () => {
    openPopover();

    for (const path of AUTHORING_PATHS) {
      expect(screen.getByTestId(`authoring-path-${path.id}`)).toHaveTextContent(path.how);
    }
  });

  it('links the full guide to a URL a reader without a checkout can open', () => {
    openPopover();

    const guide = screen.getByRole('link', { name: /full guide/i });
    expect(guide).toHaveAttribute(
      'href',
      'https://github.com/Appsilon/mediforce/blob/main/docs/guides/create-workflow.md',
    );
    expect(guide).toHaveAttribute('target', '_blank');
  });

  it('opens the importer rather than describing it', () => {
    openPopover();

    expect(screen.getByTestId('authoring-path-import').querySelector('a')).toHaveAttribute(
      'href',
      '/acme?import=source',
    );
  });

  it('answers "which one do I pick?" without a trip to the guide', () => {
    openPopover();

    expect(screen.getByTestId('authoring-path-canvas')).toHaveTextContent(/exact control/i);
    expect(screen.getByTestId('authoring-path-assistant')).toHaveTextContent(/OPENROUTER_API_KEY/);
    expect(screen.getByTestId('authoring-path-import')).toHaveTextContent(/one-time copy/i);
  });
});
