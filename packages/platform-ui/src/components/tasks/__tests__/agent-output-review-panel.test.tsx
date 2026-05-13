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
    estimatedCostUsd: null,
    tokenUsage: null,
    gitMetadata: null,
    presentation: null,
    escalationReason: null,
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

  it('renders escalation badge when escalationReason is set', () => {
    const agentOutput = buildAgentOutput({
      result: { verdict: 'approve' },
      confidence: 0.72,
      escalationReason: 'low_confidence',
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    expect(screen.getByText(/escalated: low confidence/i)).toBeInTheDocument();
  });

  it('omits escalation badge when escalationReason is null', () => {
    const agentOutput = buildAgentOutput({
      result: { verdict: 'approve' },
      confidence: 0.9,
      escalationReason: null,
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    expect(screen.queryByText(/escalated/i)).not.toBeInTheDocument();
  });

  it('renders iterations_limit escalation badge', () => {
    const agentOutput = buildAgentOutput({
      result: { verdict: 'revise' },
      escalationReason: 'iterations_limit',
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    expect(screen.getByText(/escalated: iterations limit reached/i)).toBeInTheDocument();
  });

  it('does not render a Git tab even when gitMetadata is present', () => {
    const agentOutput = buildAgentOutput({
      result: { verdict: 'approve' },
      gitMetadata: {
        commitSha: 'abcdef1234567890',
        branch: 'agent/run-42',
        changedFiles: ['file.ts'],
        repoUrl: 'https://github.com/example/repo',
      },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    // No "Git" tab trigger
    const tabs = screen.queryAllByRole('tab');
    expect(tabs.find((tab) => tab.textContent === 'Git')).toBeUndefined();
    // No compare link
    const links = document.querySelectorAll('a');
    for (const a of Array.from(links)) {
      expect(a.getAttribute('href') ?? '').not.toContain('/compare/main...');
    }
  });

  it('renders object-array entries before long-text entries in Extracted Data', () => {
    const longYaml = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
    const agentOutput = buildAgentOutput({
      presentation: null,
      result: {
        proposed_rules_yaml: longYaml,
        proposed_rules: [
          { rule_id: 'R1', description: 'first' },
          { rule_id: 'R2', description: 'second' },
        ],
      },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} />);

    // The object-array header contains a "(2)" count suffix; the long-text
    // header is the plain "Proposed Rules Yaml" label.
    const yamlLabel = screen.getByText('Proposed Rules Yaml');
    const rulesLabel = Array.from(document.querySelectorAll('dt'))
      .find((node) => node.textContent?.startsWith('Proposed Rules ')) ?? null;
    expect(rulesLabel).not.toBeNull();

    expect(
      rulesLabel!.compareDocumentPosition(yamlLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders cost and token usage when present (single metrics row)', () => {
    const agentOutput = buildAgentOutput({
      result: { ok: true },
      confidence: 0.88,
      model: 'haiku',
      duration_ms: 78000,
      estimatedCostUsd: 0.0123,
      tokenUsage: { inputTokens: 59, outputTokens: 6297 },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} instanceId="run-1" />);

    expect(screen.getByText(/\$0\.012/)).toBeInTheDocument();
    // Tokens shown as "in/out" with localized separators
    expect(screen.getByText(/59/)).toBeInTheDocument();
    expect(screen.getByText(/6,297/)).toBeInTheDocument();
    // Confidence rendered exactly once now that the display owns the metrics row
    const matches = screen.queryAllByText(/88%/);
    expect(matches.length).toBe(1);
  });

  it('renders rule-card layout for object-array entries with id+message+severity', () => {
    const agentOutput = buildAgentOutput({
      result: {
        proposed_rules: [
          {
            id: 'R-001',
            domain: 'AE',
            severity: 'critical',
            message: 'Adverse event missing onset date',
            variable: 'AESTDTC',
            check: 'is_required',
          },
        ],
      },
    });

    render(<AgentOutputReviewPanel agentOutput={agentOutput} instanceId="run-1" />);

    // The rule id should be visible
    expect(screen.getByText('R-001')).toBeInTheDocument();
    // Severity rendered as a pill (case-insensitive label "critical")
    expect(screen.getByText('critical')).toBeInTheDocument();
    // Message becomes primary content
    expect(screen.getByText('Adverse event missing onset date')).toBeInTheDocument();
  });

  it('preserves YAML structure with strict-pre (no wrap collapse)', async () => {
    const yaml = '- id: R-001\n  domain: AE\n  message: Missing date\n- id: R-002\n  domain: CM\n  message: Bad code';
    const agentOutput = buildAgentOutput({
      presentation: null,
      result: { proposed_rules_yaml: yaml },
    });

    const { container } = render(
      <AgentOutputReviewPanel agentOutput={agentOutput} instanceId="run-1" />,
    );

    // Open the collapsible trigger that summarises the YAML
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('lines'),
    );
    expect(trigger).toBeDefined();
    trigger!.click();

    // Wait a tick for Collapsible.Content to render
    await Promise.resolve();

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.className).toMatch(/whitespace-pre\b/);
    expect(pre!.className).not.toMatch(/whitespace-pre-wrap/);
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
