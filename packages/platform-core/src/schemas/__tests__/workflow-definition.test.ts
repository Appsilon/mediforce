import { describe, it, expect } from 'vitest';
import {
  WorkflowDefinitionSchema,
  resolveStepTimeoutMinutes,
  resolveStepTimeoutMs,
  resolveStrandedBudgetMs,
  STRANDED_STEP_GRACE_MS,
  type WorkflowStep,
} from '../workflow-definition';

const baseWd = {
  name: 'sftp-monitor',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'scan', name: 'Scan', type: 'creation' as const, executor: 'script' as const },
    { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
  ],
  transitions: [{ from: 'scan', to: 'done' }],
  triggers: [{ type: 'manual' as const, name: 'Start' }],
};

describe('WorkflowDefinitionSchema — inputForNextRun', () => {
  it('accepts a definition without inputForNextRun', () => {
    expect(() => WorkflowDefinitionSchema.parse(baseWd)).not.toThrow();
  });

  it('accepts a definition with valid inputForNextRun', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [{ stepId: 'scan', output: 'cursor', as: 'cursor' }],
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects when stepId does not match any step', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [
        { stepId: 'does-not-exist', output: 'cursor', as: 'cursor' },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(
        /does not match any step id/,
      );
    }
  });

  it('rejects duplicate `as` names within inputForNextRun', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [
        { stepId: 'scan', output: 'cursor', as: 'cursor' },
        { stepId: 'scan', output: 'other', as: 'cursor' },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /duplicated/.test(i.message)),
      ).toBe(true);
    }
  });

  it('rejects empty string fields in an entry', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [{ stepId: '', output: '', as: '' }],
    };
    expect(WorkflowDefinitionSchema.safeParse(wd).success).toBe(false);
  });
});

describe('WorkflowDefinitionSchema — verdicts', () => {
  const wdWithReview = {
    ...baseWd,
    steps: [
      { id: 'scan', name: 'Scan', type: 'creation' as const, executor: 'script' as const },
      {
        id: 'review',
        name: 'Review',
        type: 'review' as const,
        executor: 'human' as const,
        verdicts: {
          approve: { target: 'done' },
          revise: { target: 'scan' },
        },
      },
      { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
    ],
    transitions: [
      { from: 'scan', to: 'review' },
    ],
  };

  it('accepts a human review step with approve + revise verdicts', () => {
    expect(() => WorkflowDefinitionSchema.parse(wdWithReview)).not.toThrow();
  });

  it('accepts a human review step with N custom verdict keys (no autonomyLevel)', () => {
    // Allowlist applies to L3 only — human review steps can carry any verdict
    // key, with label/intent/requiresComment overrides.
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              verdicts: {
                accept: { target: 'done', label: 'Accept', intent: 'success' as const },
                reject: {
                  target: 'scan',
                  label: 'Reject',
                  intent: 'danger' as const,
                  requiresComment: true,
                },
                ask_changes: {
                  target: 'scan',
                  label: 'Ask for changes',
                  intent: 'warning' as const,
                  requiresComment: true,
                },
              },
            }
          : step,
      ),
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('accepts an L3 agent step with approve + revise verdicts', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              executor: 'agent' as const,
              autonomyLevel: 'L3' as const,
              verdicts: {
                approve: { target: 'done' },
                revise: { target: 'review' },
              },
            }
          : step,
      ),
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects an L3 agent step using a verdict key outside the L3 allowlist', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              executor: 'agent' as const,
              autonomyLevel: 'L3' as const,
              verdicts: {
                accept: { target: 'done' },
                retry: { target: 'review' },
              },
            }
          : step,
      ),
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => /verdict key 'accept'.*L3 step.*not allowed/.test(m))).toBe(true);
      expect(messages.some((m) => /verdict key 'retry'.*L3 step.*not allowed/.test(m))).toBe(true);
    }
  });

  it('rejects when a verdict target points at a missing step', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              verdicts: {
                approve: { target: 'nope' },
                revise: { target: 'scan' },
              },
            }
          : step,
      ),
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          /verdict 'approve'.*targets 'nope'.*does not match/.test(issue.message),
        ),
      ).toBe(true);
    }
  });

  it('does not enforce the L3 allowlist on non-L3 steps', () => {
    // A `decision` step or any non-L3 step can keep custom verdict keys —
    // the L3 revision loop is the only constraint.
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              type: 'decision' as const,
              verdicts: {
                'route-a': { target: 'done' },
                'route-b': { target: 'scan' },
              },
            }
          : step,
      ),
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });
});

describe('WorkflowDefinitionSchema — script step config', () => {
  function wdWithScanStep(scanStep: Record<string, unknown>) {
    return {
      ...baseWd,
      steps: [
        { id: 'scan', name: 'Scan', type: 'creation' as const, ...scanStep },
        { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
      ],
    };
  }

  function issueMessages(wd: Record<string, unknown>): string[] {
    const result = WorkflowDefinitionSchema.safeParse(wd);
    if (result.success) return [];
    return result.error.issues.map((issue) => issue.message);
  }

  it('accepts a script-container step with script.command', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      script: { command: 'python /scripts/scan.py', image: 'python:3.12-slim' },
    });
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('accepts a script-container step with script.inlineScript + runtime', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      script: { inlineScript: 'print("ok")', runtime: 'python' },
    });
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects the old shape: executor=script with script config under step.agent', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      agent: { command: 'python /scripts/scan.py', image: 'python:3.12-slim' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /agent config is not allowed on script steps.*step\.script/.test(m))).toBe(true);
    expect(messages.some((m) => /no script config/.test(m))).toBe(true);
  });

  it('rejects executor=agent with plugin=script-container', () => {
    const wd = wdWithScanStep({
      executor: 'agent',
      plugin: 'script-container',
      agent: { inlineScript: 'print("ok")', runtime: 'python' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /plugin 'script-container' requires executor='script'/.test(m))).toBe(true);
  });

  it('rejects autonomyLevel on a script step', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      autonomyLevel: 'L4',
      script: { command: 'run', image: 'alpine:3.19' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /autonomyLevel is not allowed on script steps/.test(m))).toBe(true);
  });

  it('rejects cowork config on a script step', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      cowork: { agent: 'chat' },
      script: { command: 'run', image: 'alpine:3.19' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /cowork config is not allowed on script steps/.test(m))).toBe(true);
  });

  it('rejects a script-container step without script config', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /plugin 'script-container' but no script config/.test(m))).toBe(true);
  });

  it('rejects script config on a non-script executor', () => {
    const wd = wdWithScanStep({
      executor: 'human',
      script: { command: 'run' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /script config but executor is 'human'/.test(m))).toBe(true);
  });

  it('rejects script config when neither command nor inlineScript is set', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      script: { image: 'alpine:3.19' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /exactly one of command or inlineScript/.test(m))).toBe(true);
  });

  it('rejects script config when both command and inlineScript are set', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      script: { command: 'run', inlineScript: 'echo ok', runtime: 'bash' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /exactly one of command or inlineScript/.test(m))).toBe(true);
  });

  it('rejects inlineScript without runtime', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'script-container',
      script: { inlineScript: 'echo ok' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /runtime is required when inlineScript is set/.test(m))).toBe(true);
  });

  it('accepts a databricks-job step without pollIntervalMs (plugin defaults to 10s)', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'databricks-job',
      databricks: { jobId: 123, notebookParams: { study: 'CDISCPILOT01' } },
    });
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0].databricks?.pollIntervalMs).toBeUndefined();
    }
  });

  it('accepts a databricks-job step with string jobId (interpolation)', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'databricks-job',
      databricks: { jobId: '${triggerPayload.jobId}' },
    });
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects a databricks-job step without databricks config', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'databricks-job',
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /plugin 'databricks-job' but no databricks config/.test(m))).toBe(true);
  });

  it('rejects databricks config without jobId', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'databricks-job',
      databricks: { notebookParams: {} },
    });
    expect(WorkflowDefinitionSchema.safeParse(wd).success).toBe(false);
  });

  it('rejects a script config paired with the databricks-job plugin', () => {
    const wd = wdWithScanStep({
      executor: 'script',
      plugin: 'databricks-job',
      script: { command: 'run' },
    });
    const messages = issueMessages(wd);
    expect(messages.some((m) => /script config but plugin is 'databricks-job' \(expected 'script-container'\)/.test(m))).toBe(true);
  });
});

describe('resolveStepTimeoutMinutes', () => {
  const baseStep: WorkflowStep = {
    id: 'step-1',
    name: 'Step 1',
    type: 'creation',
    executor: 'script',
  };

  it('prefers agent.timeoutMinutes', () => {
    expect(resolveStepTimeoutMinutes({
      ...baseStep,
      agent: { timeoutMinutes: 5 },
      script: { command: 'run', timeoutMinutes: 10 },
    })).toBe(5);
  });

  it('falls back to script.timeoutMinutes', () => {
    expect(resolveStepTimeoutMinutes({
      ...baseStep,
      script: { command: 'run', timeoutMinutes: 10 },
      databricks: { jobId: 1, pollIntervalMs: 10_000, timeoutMinutes: 20 },
    })).toBe(10);
  });

  it('falls back to databricks.timeoutMinutes', () => {
    expect(resolveStepTimeoutMinutes({
      ...baseStep,
      databricks: { jobId: 1, pollIntervalMs: 10_000, timeoutMinutes: 20 },
    })).toBe(20);
  });

  it('defaults to 30 when no config carries a timeout', () => {
    expect(resolveStepTimeoutMinutes(baseStep)).toBe(30);
  });
});

describe('reap / stranded budgets', () => {
  const baseStep: WorkflowStep = {
    id: 'step-1',
    name: 'Step 1',
    type: 'creation',
    executor: 'script',
  };

  it('resolveStepTimeoutMs is the effective timeout in milliseconds', () => {
    expect(resolveStepTimeoutMs({ ...baseStep, script: { command: 'run', timeoutMinutes: 10 } })).toBe(10 * 60_000);
    expect(resolveStepTimeoutMs(baseStep)).toBe(30 * 60_000);
  });

  it('resolveStrandedBudgetMs is the effective timeout plus the shared grace', () => {
    expect(resolveStrandedBudgetMs({ ...baseStep, script: { command: 'run', timeoutMinutes: 10 } }))
      .toBe(10 * 60_000 + STRANDED_STEP_GRACE_MS);
  });

  it('resolveStrandedBudgetMs on a timeout-less step is the default-timeout fallback bound', () => {
    expect(resolveStrandedBudgetMs({})).toBe(30 * 60_000 + STRANDED_STEP_GRACE_MS);
  });
});

describe('WorkflowDefinitionSchema — assignedTo', () => {
  it('accepts assignedTo (with interpolation) on a human step', () => {
    const wd = {
      ...baseWd,
      steps: [
        { id: 'scan', name: 'Scan', type: 'creation' as const, executor: 'script' as const },
        {
          id: 'review',
          name: 'Review',
          type: 'creation' as const,
          executor: 'human' as const,
          assignedTo: '${triggerPayload.userId}',
        },
        { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
      ],
      transitions: [
        { from: 'scan', to: 'review' },
        { from: 'review', to: 'done' },
      ],
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects assignedTo on a non-human step', () => {
    const wd = {
      ...baseWd,
      steps: [
        {
          id: 'scan',
          name: 'Scan',
          type: 'creation' as const,
          executor: 'script' as const,
          assignedTo: '${triggerPayload.userId}',
        },
        { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          /assignedTo.*executor is 'script'/.test(issue.message),
        ),
      ).toBe(true);
    }
  });
});
