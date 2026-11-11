import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const register = vi.fn().mockResolvedValue({});

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    workflows: {
      list: vi.fn().mockResolvedValue({
        definitions: [{
          name: 'ae-review',
          definition: {
            name: 'ae-review',
            version: 1,
            steps: [
              { id: 'grade', name: 'Grade', type: 'creation', executor: 'agent', plugin: 'opencode-agent', agent: { model: 'openai/gpt-5.2' } },
              { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
            ],
            transitions: [{ from: 'grade', to: 'done' }],
          },
        }],
      }),
      register: (...args: unknown[]) => register(...args),
    },
    agents: { get: vi.fn().mockResolvedValue({ agent: { id: 'grader', kind: 'plugin', runtimeId: 'opencode-agent' } }) },
  },
}));

vi.mock('@/hooks/use-model-registry', () => ({
  usePinnedDefaultModel: () => 'openai/gpt-5.2',
  useDefaultModel: () => 'openai/gpt-5.2',
  useModelRegistry: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));

import { UseInWorkflowStep } from '../agent-assistant-panel';

describe('UseInWorkflowStep', () => {
  it('drops a step model that is only the workspace default, so the bound agent\'s own model applies', async () => {
    render(<UseInWorkflowStep namespace="acme" agentId="grader" />);
    fireEvent.click(screen.getByRole('button', { name: 'Use in a workflow step' }));
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(screen.getByRole('option', { name: 'ae-review — Grade' })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: 'ae-review:grade' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    const body = register.mock.calls[0]?.[0] as { steps: Array<{ id: string; agentId?: string; agent?: { model?: string } }> };
    const grade = body.steps.find((step) => step.id === 'grade');
    expect(grade?.agentId).toBe('grader');
    expect(grade?.agent?.model).toBeUndefined();
  });
});
