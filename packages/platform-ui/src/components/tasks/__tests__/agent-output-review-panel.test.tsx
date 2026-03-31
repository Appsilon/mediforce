import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentOutputReviewPanel } from '../agent-output-review-panel';
import type { AgentOutputData } from '../task-utils';

function buildAgentOutput(overrides: Partial<AgentOutputData> = {}): AgentOutputData {
  return {
    confidence: null,
    confidence_rationale: null,
    reasoning: null,
    result: null,
    model: null,
    duration_ms: null,
    gitMetadata: null,
    presentation: null,
    ...overrides,
  };
}

describe('AgentOutputReviewPanel', () => {
  it('renders sandboxed iframe when presentation exists', () => {
    const agentOutput = buildAgentOutput({
      presentation: '<div>Report</div>',
      result: { summary: 'test data' },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('iframe has sandbox="allow-scripts" (no allow-same-origin)', () => {
    const agentOutput = buildAgentOutput({
      presentation: '<div>Content</div>',
      result: { key: 'value' },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('falls back to JSON tree tabs when no presentation', () => {
    const agentOutput = buildAgentOutput({
      presentation: null,
      result: { foo: 'bar' },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    // No iframe should be rendered
    const iframe = document.querySelector('iframe');
    expect(iframe).toBeNull();

    // Data tabs should still be present
    expect(screen.getByText('Extracted Data')).toBeInTheDocument();
    expect(screen.getByText('Raw JSON')).toBeInTheDocument();
  });

  it('raw data tabs still accessible when presentation is shown', () => {
    const agentOutput = buildAgentOutput({
      presentation: '<p>Visual report</p>',
      result: { metric: 42 },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    // Presentation tab should exist
    expect(screen.getByText('Presentation')).toBeInTheDocument();

    // Data tabs should also be in the tab list
    expect(screen.getByText('Extracted Data')).toBeInTheDocument();
    expect(screen.getByText('Raw JSON')).toBeInTheDocument();
  });

  it('injects window.__data__ with result JSON into srcdoc', () => {
    const result = { drug: 'Keytruda', score: 0.95 };
    const agentOutput = buildAgentOutput({
      presentation: '<div id="chart"></div>',
      result,
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();

    const srcdoc = iframe!.getAttribute('srcdoc');
    expect(srcdoc).not.toBeNull();
    expect(srcdoc).toContain(`window.__data__ = ${JSON.stringify(result)}`);
  });

  it('uses Tailwind v4 browser script in srcdoc', () => {
    const agentOutput = buildAgentOutput({
      presentation: '<p>Report</p>',
      result: { ok: true },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('@tailwindcss/browser@4');
  });

  it('escapes closing script tags in result data', () => {
    const result = { html: '</script><script>alert(1)</script>' };
    const agentOutput = buildAgentOutput({
      presentation: '<p>Test</p>',
      result,
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    const srcdoc = document.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).not.toContain('</script><script>alert');
    expect(srcdoc).toContain('<\\/script>');
  });
});
