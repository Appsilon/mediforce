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

  it('covers the paths that live outside the browser, not only the canvas ones', () => {
    openPopover();

    // The two paths a checkout-less user cannot discover by clicking around:
    // the agent skill and the CLI it hands off to.
    expect(screen.getByTestId('authoring-path-agent')).toHaveTextContent('/design-workflow');
    expect(screen.getByTestId('authoring-path-agent')).toHaveTextContent('mediforce workflow register');
    expect(screen.getByTestId('authoring-path-import')).toHaveTextContent(/git/i);
  });

  it('says how to reach the agent skill, not only that it exists', () => {
    openPopover();

    // Naming the skill is useless to someone who has never cloned the repo:
    // the entry has to carry the clone and the invocation.
    const agent = screen.getByTestId('authoring-path-agent');
    expect(agent).toHaveTextContent('git clone https://github.com/Appsilon/mediforce');
    expect(agent).toHaveTextContent(/Claude Code/i);
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
