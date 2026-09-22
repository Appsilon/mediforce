import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

let pathname = '/test';
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: pushMock }),
}));

const { TourProvider, useTour } = await import('../tour-provider');
const { GuideTrigger } = await import('../tour-triggers');

function ScenarioStarter() {
  const { startScenario } = useTour();
  return (
    <button type="button" onClick={() => startScenario('run')} data-testid="start-run-scenario">
      run
    </button>
  );
}

function wrap(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mount() {
  return render(
    wrap(
    <TourProvider>
      <div data-tour="workflow-list">workflows</div>
      <GuideTrigger />
      <ScenarioStarter />
    </TourProvider>,
    ),
  );
}

beforeEach(() => {
  pathname = '/test';
  pushMock.mockClear();
});

describe('guide', () => {
  it('walks the chapter for the current route and closes on the last step', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));

    const card = screen.getByTestId('tour-card');
    expect(card.textContent).toContain('Your workflows live here');
    expect(card.textContent).toContain('1 of ');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('tour-card').textContent).toContain('2 of ');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('tour-card').textContent).toContain('1 of ');

    while (screen.queryByRole('button', { name: 'Next' }) !== null) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('leaves the arrow keys to a focused input', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));

    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    expect(screen.getByTestId('tour-card').textContent).toContain('1 of ');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('tour-card').textContent).toContain('2 of ');
    field.remove();
  });

  it('puts focus on the card so a screen reader is told it opened', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    expect(document.activeElement).toBe(screen.getByTestId('tour-card'));
  });

  it('drops out from any step, not just the last', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('tour-card').textContent).toContain('2 of ');

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('ends on Escape', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('leaves Escape to a dialog opened on top of it', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('tour-overlay')).toBeTruthy();

    dialog.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('still runs a step whose target is not on the page', () => {
    pathname = '/test/tasks';
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    expect(screen.getByTestId('tour-card').textContent).toContain('Everything waiting on a person');
  });
});

describe('demo scenarios', () => {
  it('survives the navigation a guide would end on', () => {
    const view = mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    expect(screen.getByTestId('tour-card').textContent).toContain('1 of ');

    pathname = '/test/workflows/etymology-checker';
    view.rerender(
      wrap(
        <TourProvider>
          <GuideTrigger />
          <ScenarioStarter />
        </TourProvider>,
      ),
    );
    expect(screen.queryByTestId('tour-card')).not.toBeNull();
  });

  it('takes the viewer to the page a step happens on', () => {
    pathname = '/test/workflows/etymology-checker/runs/r1';
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    expect(pushMock).toHaveBeenCalledWith('/test/workflows/etymology-checker?tab=triggers');
  });

  it('never invents a parameter, so a guide step is left where it is', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows what the viewer is being asked to do', () => {
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('tour-card').textContent).toContain('Press Start Run');
  });
});
