import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const { UnsavedChangesGuard } = await import('../unsaved-changes-guard');

function renderWithLink(when: boolean) {
  return render(
    <>
      <UnsavedChangesGuard when={when} />
      <a href="/acme/workflows">Workflows</a>
      <a href="https://example.com/docs">Docs</a>
    </>,
  );
}

/** Clicks an anchor and reports whether the navigation was cancelled. */
function clickLink(name: string): boolean {
  const anchor = screen.getByRole('link', { name });
  return !fireEvent.click(anchor);
}

const PROMPT = 'You have unsaved changes. Are you sure you want to leave?';

describe('UnsavedChangesGuard', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('asks before an in-app link discards unsaved work', () => {
    renderWithLink(true);

    expect(clickLink('Workflows')).toBe(true);
    expect(screen.getByText(PROMPT)).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('stays put when the user declines', () => {
    renderWithLink(true);
    clickLink('Workflows');

    fireEvent.click(screen.getByRole('button', { name: 'Stay on this page' }));

    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('navigates to the held destination once the user confirms', () => {
    renderWithLink(true);
    clickLink('Workflows');

    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));

    expect(pushMock).toHaveBeenCalledWith('/acme/workflows');
  });

  it('lets links through when there is nothing to lose', () => {
    renderWithLink(false);

    clickLink('Workflows');

    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('ignores links that leave the app entirely', () => {
    renderWithLink(true);

    clickLink('Docs');

    expect(screen.queryByText(PROMPT)).toBeNull();
  });
});
