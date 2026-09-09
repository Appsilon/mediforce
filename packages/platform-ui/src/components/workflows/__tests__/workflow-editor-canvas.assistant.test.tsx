import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkflowStep } from '@mediforce/platform-core';

// ---- Mocks (must be before component import) ----

const assistantState = vi.hoisted(() => ({
  planCalls: [] as { messages: { role: string; content: string }[]; signal?: AbortSignal }[],
  askCalls: [] as { messages: { role: string; content: string }[]; signal?: AbortSignal }[],
  plan: { plan: ['Poll SFTP, validate, then report.'], questions: [] as unknown[], phases: [] as string[] },
  /** Resolves the ask call, so a test can halt a turn that is still in flight. */
  askResolver: null as null | ((value: unknown) => void),
}));

vi.mock('@/lib/mediforce', () => ({
  ApiError: class ApiError extends Error {},
  mediforce: {
    assistant: {
      plan: (input: { messages: { role: string; content: string }[] }, options: { signal?: AbortSignal }) => {
        assistantState.planCalls.push({ messages: input.messages, signal: options.signal });
        return Promise.resolve(assistantState.plan);
      },
      ask: (input: { messages: { role: string; content: string }[] }, options: { signal?: AbortSignal }) => {
        assistantState.askCalls.push({ messages: input.messages, signal: options.signal });
        return new Promise((resolve, reject) => {
          assistantState.askResolver = resolve;
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    },
  },
}));

vi.mock('@/components/command-palette', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('@/hooks/use-workspace-roles', () => ({
  useWorkspaceRoles: () => ({ roles: [] }),
}));

vi.mock('@/hooks/use-docker-images', () => ({
  useDockerImages: () => ({ images: [] }),
  isImageAvailable: () => true,
}));

vi.mock('@/components/workflows/workflow-diagram', () => ({
  WorkflowDiagram: () => <div data-testid="diagram" />,
}));

import { WorkflowEditorCanvas } from '../workflow-editor-canvas';

// jsdom has no scrolling; the pane scrolls its thread to the newest message.
Element.prototype.scrollTo = vi.fn();

const STEPS: WorkflowStep[] = [
  { id: 'draft', name: 'Draft', type: 'creation', executor: 'human' },
  { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
];

function openAssistant(): void {
  render(
    <WorkflowEditorCanvas
      initialSteps={STEPS}
      initialTransitions={[{ from: 'draft', to: 'done' }]}
      namespace="acme"
      workflowName="cdisc"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /expand ai assistant/i }));
}

async function ask(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(/ask ai to build/i), { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message to the assistant'));
  await waitFor(() => { expect(assistantState.askCalls.length).toBe(1); });
}

describe('WorkflowEditorCanvas — the assistant pane', () => {
  beforeEach(() => {
    assistantState.planCalls = [];
    assistantState.askCalls = [];
    assistantState.askResolver = null;
    assistantState.plan = { plan: ['Poll SFTP, validate, then report.'], questions: [], phases: [] };
  });

  it('does not send the plan it showed back to the model', async () => {
    // The failure this replaces: the plan reads as the assistant's own last
    // turn, so the model answers "shall I go ahead?" instead of building.
    openAssistant();
    await ask('Build a CDISC validation workflow.');

    expect(screen.getByText('Poll SFTP, validate, then report.')).toBeTruthy();
    expect(assistantState.askCalls[0]?.messages).toEqual([
      { role: 'user', content: 'Build a CDISC validation workflow.' },
    ]);
  });

  it('halts the turn in flight and says so, rather than leaving it running', async () => {
    openAssistant();
    await ask('Build a CDISC validation workflow.');

    fireEvent.click(screen.getByLabelText('Stop the assistant'));

    expect(assistantState.askCalls[0]?.signal?.aborted).toBe(true);
    await waitFor(() => {
      expect(screen.getByText(/Stopped\. Nothing was changed on the canvas\./)).toBeTruthy();
    });
    expect(screen.queryByLabelText('Stop the assistant')).toBeNull();
  });
});
