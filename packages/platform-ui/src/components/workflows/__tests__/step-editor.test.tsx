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

    // "Creation" appears in both the header icon bar and the locked type field
    const matches = screen.getAllByText('Creation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] step type label shows Creation not Input', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Creation').length).toBeGreaterThanOrEqual(1);
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

    // "End" appears in both the header icon bar and the locked type field
    expect(screen.getAllByText('End').length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] lock icon present on step type badge', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    const badge = screen.getByTitle(
      'Step type is set at creation. To change, remove this step and add a new one.',
    );
    expect(badge).toBeInTheDocument();
  });

  // ── New: icon header ──────────────────────────────────────────────────────

  it('[RENDER] header shows step name prominently', () => {
    render(
      <StepEditor
        step={buildStep({ name: 'My Agent Step', executor: 'agent', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Step name appears in the header
    expect(screen.getByText('My Agent Step')).toBeInTheDocument();
  });

  it('[RENDER] header shows executor label for agent step', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'agent', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('[RENDER] header shows executor label for human step', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'human', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('Human')).toBeInTheDocument();
  });

  it('[RENDER] header shows executor label for script step', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'script', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('Script')).toBeInTheDocument();
  });

  it('[RENDER] header shows Review type label for review step', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'review', executor: 'human' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Review').length).toBeGreaterThanOrEqual(1);
  });

  // ── New: tooltip info icons ───────────────────────────────────────────────

  it('[RENDER] tooltip info icons are present on identity fields', () => {
    render(
      <StepEditor
        step={buildStep()}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Identity fields (name, id, description, type, executor) all have tooltips.
    // FieldTooltip renders with data-testid="field-tooltip-trigger".
    const tooltipTriggers = document.querySelectorAll('[data-testid="field-tooltip-trigger"]');
    expect(tooltipTriggers.length).toBeGreaterThan(0);
  });

  it('[RENDER] agent config fields are shown for agent executor', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'agent' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Agent-specific labels should be visible
    expect(screen.getByText('autonomyLevel')).toBeInTheDocument();
    expect(screen.getByText('agentId')).toBeInTheDocument();
    expect(screen.getByText('agent.model')).toBeInTheDocument();
    expect(screen.getByText('agent.prompt')).toBeInTheDocument();
  });

  it('[RENDER] script config fields are shown for script executor', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'script' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('agent.runtime')).toBeInTheDocument();
    expect(screen.getByText('agent.command')).toBeInTheDocument();
    expect(screen.getByText('agent.inlineScript')).toBeInTheDocument();
  });

  it('[RENDER] human config shows allowedRoles field', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'human' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getByText('allowedRoles')).toBeInTheDocument();
  });

  it('[RENDER] no placeholder text on regular inputs', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'agent' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Regular inputs (not textareas) should have no placeholder text
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const inputsWithPlaceholder = Array.from(inputs).filter(
      (el) => el.getAttribute('placeholder') !== null && el.getAttribute('placeholder') !== '',
    );
    expect(inputsWithPlaceholder).toHaveLength(0);
  });
});
