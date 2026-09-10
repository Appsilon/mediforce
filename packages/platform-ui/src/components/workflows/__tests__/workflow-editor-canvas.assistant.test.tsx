import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkflowStep } from '@mediforce/platform-core';

// ---- Mocks (must be before component import) ----

const secretState = vi.hoisted(() => ({ keys: ['OPENROUTER_API_KEY'] as string[] }));

const assistantState = vi.hoisted(() => ({
  planCalls: [] as { messages: { role: string; content: string }[]; signal?: AbortSignal }[],
  askCalls: [] as { messages: { role: string; content: string }[]; signal?: AbortSignal }[],
  plan: { plan: ['Poll SFTP, validate, then report.'], questions: [] as unknown[], phases: [] as string[] },
  /** Resolves the ask call, so a test can halt a turn that is still in flight. */
  askResolver: null as null | ((value: unknown) => void),
  /** Set to answer the build immediately instead of leaving it in flight. */
  askResult: null as null | { reply?: string; toolCalls?: unknown[] },
  /** Set to make the planning call fail the way a refused request does. */
  planError: null as null | Error,
}));

vi.mock('@/lib/mediforce', () => {
  const assistant = {
    plan: (input: { messages: { role: string; content: string }[] }, options: { signal?: AbortSignal }) => {
      assistantState.planCalls.push({ messages: input.messages, signal: options.signal });
      if (assistantState.planError !== null) return Promise.reject(assistantState.planError);
      return Promise.resolve(assistantState.plan);
    },
    ask: (input: { messages: { role: string; content: string }[] }, options: { signal?: AbortSignal }) => {
      assistantState.askCalls.push({ messages: input.messages, signal: options.signal });
      if (assistantState.askResult !== null) return Promise.resolve(assistantState.askResult);
      return new Promise((resolve, reject) => {
        assistantState.askResolver = resolve;
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    },
  };
  const secrets = { list: () => Promise.resolve({ keys: secretState.keys }) };
  return {
    ApiError: class ApiError extends Error {},
    mediforce: { assistant, secrets },
    mediforceSilent: { assistant, secrets },
  };
});

const toastState = vi.hoisted(() => ({ calls: [] as { title?: string }[] }));

vi.mock('@/components/command-palette', () => ({
  useToast: () => ({ toast: (opts: { title?: string }) => { toastState.calls.push(opts); } }),
}));

const roleState = vi.hoisted(() => ({ held: ['data-manager'] as string[] | null }));

vi.mock('@/hooks/use-workspace-roles', () => ({
  useWorkspaceRoles: () => ({ roles: [], workflowNames: [], heldRoles: roleState.held, loading: false, error: null }),
}));

vi.mock('@/hooks/use-docker-images', () => ({
  useDockerImages: () => ({ images: [] }),
  isImageAvailable: () => true,
}));

// Renders the selected step; adding a step selects it, and the real editor
// wants the auth context this test has no use for.
vi.mock('../workflow-editor/step-editor', () => ({
  StepEditor: () => <div data-testid="step-editor" />,
}));

vi.mock('@/components/workflows/workflow-diagram', () => ({
  WorkflowDiagram: () => <div data-testid="diagram" />,
}));

import { WorkflowEditorCanvas } from '../workflow-editor-canvas';
// The mocked client's own error class: the pane tells a refused request apart
// from a plan it merely could not read.
import { ApiError } from '@/lib/mediforce';

// jsdom has no scrolling; the pane scrolls its thread to the newest message.
Element.prototype.scrollTo = vi.fn();
// …and no ResizeObserver, which the tooltip's arrow measures itself with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

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
    assistantState.askResult = null;
    secretState.keys = ['OPENROUTER_API_KEY'];
    toastState.calls = [];
    assistantState.planError = null;
    roleState.held = ['data-manager'];
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

  it('says a build cannot be saved yet, without waiting for the canvas state to commit', async () => {
    // Read from the graph the reducer just returned. It used to be read back
    // from a ref mirroring state one macrotask later, which needed a
    // setTimeout to be true at all.
    assistantState.askResult = {
      reply: 'Added a validation step.',
      toolCalls: [{
        tool: 'add_step',
        arguments: { type: 'creation', executor: 'script', name: 'Validate', insertAfterId: 'draft', insertBeforeId: 'done' },
      }],
    };
    openAssistant();
    await ask('Add a validation script step.');

    await waitFor(() => {
      expect(screen.getByText(/This will not save yet: .*script block/)).toBeTruthy();
    });
  });

  it('warns, before you type, when the workspace has no OpenRouter key', async () => {
    // Without it every turn fails at the server. Saying so up front beats
    // three error toasts after the fact.
    secretState.keys = ['STUDY_ID'];
    openAssistant();

    const warning = await screen.findByLabelText(/assistant needs a key|OPENROUTER_API_KEY/i);
    // Pulsing and hoverable: it decides whether the pane works at all.
    expect(warning.className).toContain('animate-pulse');
    fireEvent.focus(warning);
    await waitFor(() => {
      expect(screen.getAllByText(/OPENROUTER_API_KEY is missing/i).length).toBeGreaterThan(0);
    });
  });

  it('says nothing when the key is set', async () => {
    openAssistant();
    await waitFor(() => { expect(screen.getByPlaceholderText(/ask ai to build/i)).toBeTruthy(); });
    expect(screen.queryByLabelText(/assistant needs a key|OPENROUTER_API_KEY/i)).toBeNull();
  });

  it('reports a refused turn once, not once per call', async () => {
    // One missing key produced three popups: the global 4xx listener fired for
    // the planning call and again for the build, and the pane added its own.
    assistantState.planError = new ApiError('OPENROUTER_API_KEY not configured in workspace secrets');
    openAssistant();
    fireEvent.change(screen.getByPlaceholderText(/ask ai to build/i), { target: { value: 'Build it.' } });
    fireEvent.click(screen.getByLabelText('Send message to the assistant'));

    await waitFor(() => { expect(toastState.calls.length).toBe(1); });
    // and it never reached the build, which would have failed the same way
    expect(assistantState.askCalls).toHaveLength(0);
  });

  it('says when a step it just wrote names a role nobody holds', () => {
    // The editor already warns about this in the step's own panel, but the
    // person asking the assistant never opens it: they read the reply, which
    // said the approval step was added and nothing else.
    assistantState.askResult = {
      reply: 'Added a senior lab approval step.',
      toolCalls: [{
        tool: 'add_step',
        arguments: {
          type: 'creation', executor: 'human', name: 'Senior approval',
          allowedRoles: ['senior-lab-member'],
          insertAfterId: 'draft', insertBeforeId: 'done',
        },
      }],
    };
    openAssistant();
    return ask('A senior lab member should approve it.').then(() => waitFor(() => {
      expect(screen.getByText(/nobody holds "senior-lab-member"/i)).toBeTruthy();
      expect(screen.getByText(/Settings → Members/)).toBeTruthy();
    }));
  });

  it('stays quiet when the role is one somebody holds', () => {
    assistantState.askResult = {
      reply: 'Added a review step.',
      toolCalls: [{
        tool: 'add_step',
        arguments: {
          type: 'creation', executor: 'human', name: 'Review',
          allowedRoles: ['data-manager'],
          insertAfterId: 'draft', insertBeforeId: 'done',
        },
      }],
    };
    openAssistant();
    return ask('A data manager should review it.').then(() => waitFor(() => {
      expect(screen.getByText('Added a review step.')).toBeTruthy();
    })).then(() => {
      expect(screen.queryByText(/nobody holds/i)).toBeNull();
    });
  });

  it('renders the reply as markdown, not as the characters it is written in', async () => {
    // The pane printed the raw string, so a reply with a list or **bold** read
    // as asterisks to the person it was written for.
    assistantState.askResult = { reply: 'Added two steps:\n\n- **Poll** the drop\n- Validate the file' };
    openAssistant();
    await ask('Build it.');

    await waitFor(() => {
      expect(document.querySelector('.cm-assistant-reply strong')?.textContent).toBe('Poll');
    });
    expect(document.querySelectorAll('.cm-assistant-reply li')).toHaveLength(2);
    expect(screen.queryByText(/\*\*Poll\*\*/)).toBeNull();
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
