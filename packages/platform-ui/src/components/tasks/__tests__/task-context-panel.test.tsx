import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import type { StepExecution } from '@mediforce/platform-core';

// Mock useStepExecutions so we can feed canned step executions to the panel.
const mockStepExecutions = vi.fn();
vi.mock('@/hooks/use-step-executions', () => ({
  useStepExecutions: (...args: unknown[]) => mockStepExecutions(...args),
}));

const mockProcessInstance = vi.fn(() => ({ data: { status: 'running' }, loading: false }));
vi.mock('@/hooks/use-process-instances', () => ({
  useProcessInstance: (...args: unknown[]) => mockProcessInstance(...args),
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
import { buildSrcdoc, MAX_IFRAME_HEIGHT } from '../iframe-helpers';

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

function setStepExecutions(executions: StepExecutionRecord[], loading = false): void {
  mockStepExecutions.mockReturnValue({ data: executions, loading, error: null });
}

async function expandPanel(): Promise<void> {
  // Panel opens by default; this helper now only clicks the trigger if
  // some prior change collapsed it. Idempotent so existing tests keep
  // working without each having to know the default state.
  const trigger = screen.getByRole('button', { name: /previous step output/i });
  if (trigger.getAttribute('aria-expanded') === 'false' || trigger.getAttribute('data-state') === 'closed') {
    await userEvent.setup().click(trigger);
  }
}

// Summary is the default selected tab. Iframe-related tests need the Report
// tab active; this helper switches to it.
async function activateReportTab(): Promise<void> {
  const reportTrigger = screen.getByRole('tab', { name: /report/i });
  await userEvent.setup().click(reportTrigger);
}

describe('TaskContextPanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockStepExecutions.mockReset();
    mockProcessInstance.mockReset();
    mockProcessInstance.mockReturnValue({ data: { status: 'running' }, loading: false });
    mockUseTheme.mockReturnValue({ resolvedTheme: 'light', setTheme: vi.fn() });
  });

  it('renders Summary tab as default with Report tab available when inline presentation is present', async () => {
    const execution = buildExecution({
      output: {
        summary: 'OK',
        presentation: '<section id="agent-report">Inline body</section>',
      },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();

    // Summary selected by default; Report tab present but inactive.
    const summaryTrigger = screen.getByRole('tab', { name: /summary/i });
    const reportTrigger = screen.getByRole('tab', { name: /report/i });
    expect(summaryTrigger.getAttribute('data-state')).toBe('active');
    expect(reportTrigger.getAttribute('data-state')).toBe('inactive');

    // Switching to Report tab reveals the inline iframe.
    await activateReportTab();
    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('<section id="agent-report">Inline body</section>');

    // No fetch needed for inline mode
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('renders report from agentOutput presentation when result output is empty', async () => {
    const execution = buildExecution({
      output: null,
      agentOutput: {
        confidence: null,
        confidence_rationale: null,
        reasoning: null,
        model: null,
        duration_ms: null,
        gitMetadata: null,
        presentation: '<section id="agent-output-report">Agent output body</section>',
      },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('srcdoc')).toContain('agent-output-report');
  });

  it('fetches the report file and renders it in the iframe when htmlReportPath is set', async () => {
    const execution = buildExecution({
      output: {
        htmlReportPath: '/output/presentation.html',
        summary: 'Validation completed',
      },
    });
    setStepExecutions([execution]);

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
    await activateReportTab();

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
    setStepExecutions([execution]);

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
    setStepExecutions([execution]);

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
    await activateReportTab();

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
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

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
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

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

  it('caps iframe height at MAX_IFRAME_HEIGHT when iframe reports a runaway-large value', async () => {
    const execution = buildExecution({
      output: { presentation: '<div>runaway</div>' },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();

    await act(async () => {
      const event = new MessageEvent('message', {
        data: { type: 'resize', height: 99999 },
        source: iframe.contentWindow,
      });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      const px = parseInt(iframe.style.height, 10);
      expect(px).toBeLessThanOrEqual(MAX_IFRAME_HEIGHT);
      expect(px).toBeGreaterThan(0);
    });
  });

  it('holds iframe height steady when iframe posts a runaway sequence of growing heights', async () => {
    const execution = buildExecution({
      output: { presentation: '<div>loop</div>' },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();

    // Simulate the ResizeObserver feedback loop: each "tick" reports a larger
    // height than the previous one, mimicking 100vh chasing the iframe size.
    for (const height of [1000, 2000, 4000, 8000, 16000, 32000]) {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'resize', height },
            source: iframe.contentWindow,
          }),
        );
      });
    }

    await waitFor(() => {
      const px = parseInt(iframe.style.height, 10);
      expect(px).toBe(MAX_IFRAME_HEIGHT);
    });
  });

  it('keeps previous iframe height when iframe reports an invalid value', async () => {
    const execution = buildExecution({
      output: { presentation: '<div>invalid</div>' },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();

    // First, a valid height sets the panel to 800px.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'resize', height: 800 },
          source: iframe.contentWindow,
        }),
      );
    });
    await waitFor(() => {
      expect(parseInt(iframe.style.height, 10)).toBe(800);
    });

    // Then, an invalid height (0 / NaN) MUST NOT collapse the iframe.
    for (const bad of [0, -1, Number.NaN]) {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'resize', height: bad },
            source: iframe.contentWindow,
          }),
        );
      });
    }

    expect(parseInt(iframe.style.height, 10)).toBe(800);
  });

  it('renders a markdown presentation inline (no iframe) when agentOutput.presentation.kind is markdown', async () => {
    const execution = buildExecution({
      output: { summary: 'OK' },
      agentOutput: {
        confidence: null,
        confidence_rationale: null,
        reasoning: null,
        model: null,
        duration_ms: null,
        gitMetadata: null,
        presentation: { kind: 'markdown', content: '## Status\n\n- one\n- two' },
      },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    // Markdown branch renders inline. The iframe path is reserved for HTML.
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a markdown presentation when agentOutput.presentation arrives as a structured object', async () => {
    // Markdown presentations live under `agentOutput.presentation`, not
    // `output.presentation` (scripts that write Markdown emit the structured
    // shape via the plugin). Confirm the panel reads from the right field.
    const execution = buildExecution({
      output: null,
      agentOutput: {
        confidence: null,
        confidence_rationale: null,
        reasoning: null,
        model: null,
        duration_ms: null,
        gitMetadata: null,
        presentation: {
          kind: 'markdown',
          content: '[issue 42](https://example.test/42)',
        },
      },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    const link = screen.getByRole('link', { name: 'issue 42' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('iframe srcdoc neutralises Tailwind viewport-height classes to avoid feedback growth', async () => {
    const execution = buildExecution({
      output: { presentation: '<div class="min-h-screen">vh content</div>' },
    });
    setStepExecutions([execution]);

    render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const srcdoc = iframe.getAttribute('srcdoc')!;
    // !important is load-bearing: without it, Tailwind's CDN-generated
    // .h-screen utility ties on specificity and may win the cascade by being
    // injected later. Assert each override uses !important so the neutralise
    // claim holds at runtime, not just in the source string.
    expect(srcdoc).toMatch(/\.h-screen[\s\S]*?,\s*\.min-h-screen[\s\S]*?,\s*\.max-h-screen/);
    expect(srcdoc).toMatch(/height:\s*auto\s*!important/);
    expect(srcdoc).toMatch(/min-height:\s*0\s*!important/);
    expect(srcdoc).toMatch(/max-height:\s*none\s*!important/);
  });

  it('posts a theme message to the iframe contentWindow when the parent theme changes', async () => {
    const execution = buildExecution({
      output: { presentation: '<div>theme-test</div>' },
    });
    setStepExecutions([execution]);

    mockUseTheme.mockReturnValue({ resolvedTheme: 'light', setTheme: vi.fn() });

    const { rerender } = render(
      <TaskContextPanel
        processInstanceId="inst-1"
        stepId="human-review"
      />,
    );
    await expandPanel();
    await activateReportTab();

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

  it('hardens srcdoc with CSP and escapes stringify fallback data', () => {
    const result = {};
    Object.defineProperty(result, 'unsafe', {
      enumerable: true,
      get() {
        throw new Error('</script><script>alert(1)</script>');
      },
    });

    const srcdoc = buildSrcdoc('<div>body</div>', result, false);

    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).not.toContain('</script><script>alert(1)</script>');
    expect(srcdoc).toContain('<\\/script><script>alert(1)<\\/script>');
  });
});
