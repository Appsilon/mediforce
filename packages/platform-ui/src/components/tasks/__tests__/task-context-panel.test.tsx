import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import type { StepExecution } from '@mediforce/platform-core';

// Mock useSubcollection so we can feed canned step executions to the panel.
const mockSubcollection = vi.fn();
vi.mock('@/hooks/use-process-instances', () => ({
  useSubcollection: (...args: unknown[]) => mockSubcollection(...args),
}));

// Mock apiFetch — Response constructor is available in jsdom environment.
const mockApiFetch = vi.fn();
vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Theme is read via next-themes; default it to light for deterministic markup.
const mockUseTheme = vi.fn(() => ({ resolvedTheme: 'light', setTheme: vi.fn() }));
vi.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}));

import { TaskContextPanel } from '../task-context-panel';

type StepExecutionRecord = StepExecution & { id: string };

function buildExecution(overrides: Partial<StepExecutionRecord> = {}): StepExecutionRecord {
  return {
    id: 'exec-1',
    instanceId: 'inst-1',
    stepId: 'interpret-validation',
    status: 'completed',
    input: {},
    output: { foo: 'bar' },
    verdict: null,
    executedBy: 'agent:claude-code',
    startedAt: '2026-04-29T10:00:00.000Z',
    completedAt: '2026-04-29T10:01:00.000Z',
    iterationNumber: 0,
    gateResult: null,
    error: null,
    ...overrides,
  };
}

function setSubcollection(executions: StepExecutionRecord[], loading = false): void {
  mockSubcollection.mockReturnValue({ data: executions, loading, error: null });
}

async function expandPanel(): Promise<void> {
  const trigger = screen.getByRole('button', { name: /previous step output/i });
  await userEvent.setup().click(trigger);
}

describe('TaskContextPanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockSubcollection.mockReset();
    mockUseTheme.mockReturnValue({ resolvedTheme: 'light', setTheme: vi.fn() });
  });

  it('renders Report tab as default when previous step output has inline presentation', async () => {
    const execution = buildExecution({
      output: {
        summary: 'OK',
        presentation: '<section id="agent-report">Inline body</section>',
      },
    });
    setSubcollection([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    // Report tab present and selected by default
    const reportTrigger = screen.getByRole('tab', { name: /report/i });
    expect(reportTrigger.getAttribute('data-state')).toBe('active');

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('<section id="agent-report">Inline body</section>');

    // No fetch needed for inline mode
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches the report file and renders it in the iframe when htmlReportPath is set', async () => {
    const execution = buildExecution({
      output: {
        htmlReportPath: '/output/presentation.html',
        summary: 'Validation completed',
      },
    });
    setSubcollection([execution]);

    mockApiFetch.mockResolvedValue(
      new Response('<article id="fetched-report">From file</article>', { status: 200 }),
    );

    render(
      <TaskContextPanel
        processInstanceId="inst-abc"
        stepId="human-review"
      />,
    );
    await expandPanel();

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });

    const fetchUrl = mockApiFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain('/api/agent-output-file');
    expect(fetchUrl).toContain('instanceId=inst-abc');
    expect(fetchUrl).toContain('stepId=interpret-validation');
    expect(fetchUrl).toContain('kind=presentation');

    await waitFor(() => {
      const iframe = document.querySelector('iframe');
      expect(iframe).not.toBeNull();
      const srcdoc = iframe!.getAttribute('srcdoc')!;
      expect(srcdoc).toContain('<article id="fetched-report">From file</article>');
    });

    const reportTrigger = screen.getByRole('tab', { name: /report/i });
    expect(reportTrigger.getAttribute('data-state')).toBe('active');
  });

  it('falls back to Summary tab when neither presentation nor htmlReportPath is present', async () => {
    const execution = buildExecution({ output: { summary: 'Plain output' } });
    setSubcollection([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    expect(screen.queryByRole('tab', { name: /report/i })).toBeNull();

    const summaryTrigger = screen.getByRole('tab', { name: /summary/i });
    expect(summaryTrigger.getAttribute('data-state')).toBe('active');

    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows an inline error notice when the report fetch returns 404 — Summary tab is still selectable', async () => {
    const execution = buildExecution({
      output: {
        htmlReportPath: '/output/presentation.html',
        summary: 'Has summary text',
      },
    });
    setSubcollection([execution]);

    mockApiFetch.mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });

    // Inline notice shows in Report tab
    await waitFor(() => {
      expect(
        screen.getByText(/report file not available — see summary tab/i),
      ).toBeInTheDocument();
    });

    // No iframe on failure
    expect(document.querySelector('iframe')).toBeNull();

    // Summary tab still works
    const user = userEvent.setup();
    const summaryTrigger = screen.getByRole('tab', { name: /summary/i });
    await user.click(summaryTrigger);
    expect(summaryTrigger.getAttribute('data-state')).toBe('active');
    expect(screen.getByText('Has summary text')).toBeInTheDocument();
  });

  it('iframe has sandbox="allow-scripts" and a srcDoc containing the agent body content', async () => {
    const presentation = '<div id="agent-body">Hello report</div>';
    const execution = buildExecution({
      output: { presentation },
    });
    setSubcollection([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
    const srcdoc = iframe!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain(presentation);
  });

  it('updates iframe height when receiving a resize message from the iframe contentWindow', async () => {
    const execution = buildExecution({
      output: { presentation: '<div>resize me</div>' },
    });
    setSubcollection([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();

    // jsdom supplies a real contentWindow. Dispatch a message event whose
    // source matches the iframe so the panel's listener updates state.
    await act(async () => {
      const event = new MessageEvent('message', {
        data: { type: 'resize', height: 875 },
        source: iframe.contentWindow,
      });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(iframe.style.height).toBe('875px');
    });
  });

  it('posts a theme message to the iframe contentWindow when the parent theme changes', async () => {
    const execution = buildExecution({
      output: { presentation: '<div>theme-test</div>' },
    });
    setSubcollection([execution]);

    mockUseTheme.mockReturnValue({ resolvedTheme: 'light', setTheme: vi.fn() });

    const { rerender } = render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    // Switch theme and force a rerender to trigger the effect.
    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark', setTheme: vi.fn() });
    rerender(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith({ type: 'theme', dark: true }, '*');
    });
  });
});
