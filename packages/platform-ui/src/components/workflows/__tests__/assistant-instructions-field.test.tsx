import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantInstructionsField } from '../workflow-editor/assistant-instructions-field';

const state = vi.hoisted(() => ({
  instructions: '',
  loading: false,
  error: null as Error | null,
  retry: vi.fn(),
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
}));

vi.mock('@/hooks/use-assistant-instructions', () => ({
  useAssistantInstructions: () => ({
    instructions: state.instructions,
    loading: state.loading,
    error: state.error,
    retry: state.retry,
  }),
  useSetAssistantInstructions: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
    isSuccess: state.isSuccess,
  }),
}));

vi.mock('@/components/command-palette', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function revealInstructions(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Show your instructions' }));
}

describe('AssistantInstructionsField', () => {
  beforeEach(() => {
    state.instructions = '';
    state.loading = false;
    state.error = null;
    state.retry.mockReset();
    state.mutate.mockReset();
    state.isPending = false;
    state.isSuccess = false;
  });

  it('does not let an unread value be overwritten after the initial read fails', () => {
    state.error = new Error('Network unavailable');
    render(<AssistantInstructionsField namespace="alpha" />);

    revealInstructions();

    expect(screen.getByRole('textbox', { name: 'Your instructions' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading your instructions' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it('does not allow a second blur-triggered save while the first is pending', () => {
    state.instructions = 'Saved instructions';
    state.isPending = true;
    render(<AssistantInstructionsField namespace="alpha" />);

    revealInstructions();

    expect(screen.getByRole('textbox', { name: 'Your instructions' })).toBeDisabled();
  });

  it('resets its draft when the workspace changes', async () => {
    state.instructions = 'Alpha instructions';
    const { rerender } = render(<AssistantInstructionsField namespace="alpha" />);

    revealInstructions();
    expect(screen.getByRole('textbox', { name: 'Your instructions' })).toHaveValue('Alpha instructions');

    state.instructions = 'Beta instructions';
    rerender(<AssistantInstructionsField namespace="beta" />);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Your instructions' })).toHaveValue('Beta instructions');
    });
  });
});
