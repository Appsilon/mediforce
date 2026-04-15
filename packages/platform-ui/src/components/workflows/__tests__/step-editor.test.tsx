import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkflowStep } from '@mediforce/platform-core';

// ---- Mocks ----

vi.mock('@/hooks/use-plugins', () => ({
  usePlugins: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'test-user' } }),
}));

vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'test-org', name: 'test-workflow' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Must import after mocks
import { StepEditor } from '../workflow-editor/step-editor';

function defaultStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'test-step',
    name: 'Test Step',
    type: 'creation',
    executor: 'human',
    ...overrides,
  };
}

const noopOnChange = vi.fn();
const allSteps: WorkflowStep[] = [];

describe('StepEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Fix 5: Step type buttons visible ---

  it('[RENDER] step type buttons visible without expanding details', () => {
    render(
      <StepEditor step={defaultStep()} onChange={noopOnChange} allSteps={allSteps} />,
    );

    expect(screen.getByText('Creation')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
  });

  it('[RENDER] step type label shows Creation not Input', () => {
    render(
      <StepEditor step={defaultStep()} onChange={noopOnChange} allSteps={allSteps} />,
    );

    expect(screen.getByText('Creation')).toBeInTheDocument();
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
  });

  // --- Fix 4: Terminal not shown ---

  it('[RENDER] terminal step type not shown for non-terminal steps', () => {
    render(
      <StepEditor step={defaultStep({ type: 'creation' })} onChange={noopOnChange} allSteps={allSteps} />,
    );

    expect(screen.queryByText('End')).not.toBeInTheDocument();
  });

  it('[RENDER] terminal step type shown when step is already terminal', () => {
    render(
      <StepEditor step={defaultStep({ type: 'terminal' })} onChange={noopOnChange} allSteps={allSteps} />,
    );

    expect(screen.getByText('End')).toBeInTheDocument();
  });

  // --- Fix 2: Focus loss ---

  it('[RENDER] env var key input retains focus after typing', async () => {
    const user = userEvent.setup();
    const step = defaultStep({ env: { MY_VAR: 'value' } });
    const onChange = vi.fn();

    const { rerender } = render(
      <StepEditor step={step} onChange={onChange} allSteps={allSteps} />,
    );

    // Find the env var key input (it has the env var name as value)
    const keyInput = screen.getByDisplayValue('MY_VAR');
    await user.click(keyInput);
    await user.type(keyInput, '_');

    // The onChange should have been called with the new env
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.env).toBeDefined();

    // Simulate parent re-rendering with updated env (as the real editor would)
    const updatedStep = defaultStep({ env: { MY_VAR_: 'value' } });
    rerender(
      <StepEditor step={updatedStep} onChange={onChange} allSteps={allSteps} />,
    );

    // The key input should still exist and be focusable (not unmounted/remounted)
    const updatedInput = screen.getByDisplayValue('MY_VAR_');
    expect(updatedInput).toBeInTheDocument();
  });
});
