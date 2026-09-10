import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkflowStep } from '@mediforce/platform-core';

const secretState = vi.hoisted(() => ({ keys: ['OPENROUTER_API_KEY'] as string[] }));

const assistantState = vi.hoisted(() => ({
  planCalls: [] as { messages: { role: string; content: string }[]; signal?: AbortSignal }[],
  askCalls: [] as { messages: { role: string; content: string }[]; signal?: AbortSignal }[],
  plan: { plan: ['Poll SFTP, validate, then report.'], questions: [] as unknown[], phases: [] as string[] },
  askResolver: null as null | ((value: unknown) => void),
  askResult: null as null | { reply?: string; toolCalls?: unknown[] },
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

vi.mock('../workflow-editor/step-editor', () => ({
  StepEditor: () => <div data-testid="step-editor" />,
}));

vi.mock('@/components/workflows/workflow-diagram', () => ({
  WorkflowDiagram: () => <div data-testid="diagram" />,
}));

import { WorkflowEditorCanvas } from '../workflow-editor-canvas';
import { ApiError } from '@/lib/mediforce';

Element.prototype.scrollTo = vi.fn();
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
    openAssistant();
    await ask('Build a CDISC validation workflow.');

    expect(screen.getByText('Poll SFTP, validate, then report.')).toBeTruthy();
    expect(assistantState.askCalls[0]?.messages).toEqual([
      { role: 'user', content: 'Build a CDISC validation workflow.' },
    ]);
  });

  it('says a build cannot be saved yet, without waiting for the canvas state to commit', async () => {
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
    secretState.keys = ['STUDY_ID'];
    openAssistant();

    const warning = await screen.findByLabelText(/assistant needs a key|OPENROUTER_API_KEY/i);
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
    assistantState.planError = new ApiError('OPENROUTER_API_KEY not configured in workspace secrets');
    openAssistant();
    fireEvent.change(screen.getByPlaceholderText(/ask ai to build/i), { target: { value: 'Build it.' } });
    fireEvent.click(screen.getByLabelText('Send message to the assistant'));

    await waitFor(() => { expect(toastState.calls.length).toBe(1); });
    expect(assistantState.askCalls).toHaveLength(0);
  });

  it('says when a step it just wrote names a role nobody holds', () => {
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
      const warning = screen.getByText(/nobody holds "senior-lab-member"/i);
      expect(warning.textContent).toMatch(/Settings → Members/);
      expect(warning.closest('[data-tone="warning"]')).not.toBeNull();
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

  it('renders a multi-line plan as a list, not one run-on paragraph', async () => {
    assistantState.plan = {
      plan: ['Fix the regex escape error', 'Replace the patterns with R syntax', 'Test the script'],
      questions: [],
      phases: [],
    };
    openAssistant();
    await ask('Fix the script.');

    await waitFor(() => {
      const plan = [...document.querySelectorAll('.cm-assistant-reply')]
        .find((node) => node.textContent?.includes('Fix the regex escape error') === true);
      expect(plan?.querySelectorAll('li')).toHaveLength(3);
    });
    expect(screen.queryByText(/error Replace/)).toBeNull();
  });

  it('renders the reply as markdown, not as the characters it is written in', async () => {
    assistantState.askResult = { reply: 'Added two steps:\n\n- **Poll** the drop\n- Validate the file' };
    openAssistant();
    await ask('Build it.');

    await waitFor(() => {
      expect(document.querySelector('.cm-assistant-reply strong')?.textContent).toBe('Poll');
    });
    const reply = document.querySelector('.cm-assistant-reply strong')?.closest('.cm-assistant-reply');
    expect(reply?.querySelectorAll('li')).toHaveLength(2);
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
