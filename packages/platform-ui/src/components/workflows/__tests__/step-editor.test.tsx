import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkflowStep } from '@mediforce/platform-core';

// ---- Mocks (must be before component import) ----

vi.mock('@/hooks/use-plugins', () => ({
  usePlugins: () => ({ plugins: [] }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ firebaseUser: null }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'test' }),
}));

vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretKeys: () => Promise.resolve([]),
}));

import { StepEditor } from '../workflow-editor/step-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Test Step',
    type: 'creation',
    executor: 'human',
    ...overrides,
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StepEditor', () => {
  it('[RENDER] step type badge visible without expanding details', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('Creation')).toBeInTheDocument();
  });

  it('[RENDER] step type label shows Creation not Input', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    // The badge should say "Creation", not "Input"
    expect(screen.getByText('Creation')).toBeInTheDocument();
    // "Input" should not appear as a step type label
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
  });

  it('[RENDER] no step type change buttons exist', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    // There should be no buttons that allow changing the step type
    // (these would be buttons labeled with type names like Creation/Review/Decision/End)
    const allButtons = screen.getAllByRole('button');
    const typeChangeLabels = ['Creation', 'Review', 'Decision', 'End'];
    for (const label of typeChangeLabels) {
      const matchingButtons = allButtons.filter(
        (btn) => btn.textContent?.trim() === label,
      );
      expect(matchingButtons).toHaveLength(0);
    }
  });

  it('[RENDER] terminal step type shows End label', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'terminal', name: 'Complete' })}
        allSteps={[buildStep({ type: 'terminal', name: 'Complete' })]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('End')).toBeInTheDocument();
  });

  it('[RENDER] lock icon present on step type badge', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    // The badge has a title attribute explaining step type is locked
    const badge = screen.getByTitle(
      'Step type is set at creation. To change, remove this step and add a new one.',
    );
    expect(badge).toBeInTheDocument();
  });
});
