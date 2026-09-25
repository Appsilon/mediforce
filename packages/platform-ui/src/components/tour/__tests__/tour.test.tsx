import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

let pathname = '/test';
let search = '';
const pushMock = vi.fn();

let demoRun: { id: string; definitionName: string; status: string } | null = null;

vi.mock('@/hooks/use-demo-run', () => ({
  useDemoRun: () => demoRun,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: pushMock }),
}));

const { TourProvider, useTour } = await import('../tour-provider');
const { GuideTrigger } = await import('../tour-triggers');
const { TourPill } = await import('../tour-pill');

function ScenarioStarter() {
  const { startScenario } = useTour();
  return (
    <>
      <button type="button" onClick={() => startScenario('run')} data-testid="start-run-scenario">
        run
      </button>
      <button type="button" onClick={() => startScenario('build')} data-testid="start-build-scenario">
        build
      </button>
    </>
  );
}

function mount() {
  return render(
    <TourProvider>
      <div data-tour="workflow-list">workflows</div>
      <GuideTrigger />
      <ScenarioStarter />
      <TourPill />
    </TourProvider>,
  );
}

beforeEach(() => {
  pathname = '/test';
  search = '';
  demoRun = null;
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

  it('folds away on demand and leaves the page alone', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    fireEvent.click(screen.getByTestId('tour-collapse'));
    expect(screen.queryByTestId('tour-card')).toBeNull();
    expect(screen.getByTestId('tour-resume')).toBeTruthy();
  });

  it('does not fold away by itself during a guide', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('tour-card')).toBeTruthy();
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
      <TourProvider>
        <GuideTrigger />
        <ScenarioStarter />
        <TourPill />
      </TourProvider>,
    );
    expect(screen.queryByTestId('tour-card')).not.toBeNull();
  });

  it('takes the viewer to the page a step happens on', () => {
    pathname = '/test/workflows/etymology-checker';
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    expect(pushMock).toHaveBeenCalledWith('/test/workflows/etymology-checker?tab=triggers');
  });

  it('starts where the viewer already stands rather than marching them back', () => {
    pathname = '/test/workflows/etymology-checker/runs/r1';
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));

    expect(screen.getByTestId('tour-card').textContent).toContain('The run tells you where it is');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('never invents a parameter, so a guide step is left where it is', () => {
    mount();
    fireEvent.click(screen.getByTestId('guide-trigger'));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('moves on to the next tab instead of sticking on the first', () => {
    pathname = '/test/workflows/etymology-checker';
    search = 'tab=triggers';
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    pushMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(pushMock).toHaveBeenCalledWith('/test/workflows/etymology-checker?tab=runs');
  });

  it('walks all the way to the run, not just between tabs', () => {
    pathname = '/test/workflows/etymology-checker';
    search = 'tab=runs';
    demoRun = { id: 'run-7', definitionName: 'etymology-checker', status: 'completed' };
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));

    // triggers -> preflight -> dry run -> the run itself
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    pushMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByTestId('tour-card').textContent).toContain('The run tells you where it is');
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/test/workflows/etymology-checker/runs/run-7');
  });

  it('gets out of the way when the viewer touches the app, and comes back', () => {
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    expect(screen.getByTestId('tour-card')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('tour-card')).toBeNull();
    expect(screen.getByTestId('tour-resume')).toBeTruthy();

    fireEvent.click(screen.getByTestId('tour-resume'));
    expect(screen.getByTestId('tour-card')).toBeTruthy();
  });

  it('stays put when the click lands inside the card', () => {
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    fireEvent.pointerDown(screen.getByTestId('tour-card'));
    expect(screen.getByTestId('tour-card')).toBeTruthy();
  });

  it('says what is missing rather than pointing at nothing', () => {
    pathname = '/test';
    demoRun = null;
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    while (screen.queryByRole('button', { name: 'Next' }) !== null) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      if (screen.getByTestId('tour-card').textContent?.includes('needs a run') === true) break;
    }
    expect(screen.getByTestId('tour-card').textContent).toContain('Start one, then come back');
  });

  it('goes back a step and stays there', () => {
    // Starting on the page a later step covers opens at that step; Back must
    // not be undone by the arrival that put us there.
    pathname = '/test/workflows/new';
    mount();
    fireEvent.click(screen.getByTestId('start-build-scenario'));
    expect(screen.getByTestId('tour-card').textContent).toContain('2 of ');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('tour-card').textContent).toContain('1 of ');
  });

  it('shows what the viewer is being asked to do', () => {
    pathname = '/test/workflows/etymology-checker';
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('tour-card').textContent).toContain('Press Start Run');
  });

  it('calls itself Demo, not Guide', () => {
    mount();
    fireEvent.click(screen.getByTestId('start-run-scenario'));
    expect(screen.getByTestId('tour-card').textContent).toContain('Demo · Run it and explore');
  });
});
