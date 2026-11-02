import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepEvaluation } from '../evaluation-tab';

const navigation = vi.hoisted(() => ({ search: '' }));
const stepEvaluation = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/acme/workflows/safety',
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluation: () => stepEvaluation.current,
  useWorkflowValidation: () => ({ data: undefined }),
}));
vi.mock('@/hooks/use-workflow-access', () => ({ useWorkflowRunGate: () => ({ mayRun: true, reason: undefined }) }));
vi.mock('@/hooks/use-workflow-versions', () => ({
  useWorkflowVersion: () => ({ definition: null, loading: false, error: null }),
  useWorkflowVersions: () => ({ versions: [], defaultVersion: null, loading: false }),
}));
vi.mock('../evaluation-assistant-panel', () => ({ EvaluationAssistantPanel: () => <div data-testid="evaluation-assistant" /> }));
vi.mock('../guided-setup', () => ({
  SETUP_STAGES: ['brief', 'cases', 'evaluators', 'review'],
  GuidedSetup: () => <div data-testid="guided-setup" />,
  SetupChoice: () => <div data-testid="evaluation-setup-choice" />,
}));
vi.mock('../step-evaluation-sections', () => ({
  EvaluationStatusStrip: () => null,
  CasesSection: () => null,
  EvalRunsSection: () => null,
  EvaluatorsSection: () => null,
  DriftAlert: () => null,
}));

const step = { kind: 'step' as const, namespace: 'acme', workflowName: 'safety', stepId: 'extract-aes' };

function renderEvaluation(mayEdit: boolean) {
  render(<StepEvaluation header={<span />} step={step} definitionVersion={1} outputSchema={undefined} mayEdit={mayEdit} editReason={undefined} mayRun runReason={undefined} />);
}

beforeEach(() => {
  navigation.search = '';
  stepEvaluation.current = {
    brief: { data: { brief: null }, isError: false },
    cases: { data: { cases: [] }, isError: false },
    evaluators: { data: { evaluators: [] }, isError: false },
    runs: { data: { evalRuns: [] }, isError: false, isLoading: false },
  };
});

describe('StepEvaluation', () => {
  it('offers an empty subject the choice of setup', () => {
    renderEvaluation(true);
    expect(screen.getByTestId('evaluation-setup-choice')).toBeInTheDocument();
  });

  it('opens on the tabs, not on Loading forever, when a query failed', () => {
    stepEvaluation.current = { ...stepEvaluation.current, brief: { data: undefined, isError: true } };
    renderEvaluation(true);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByTestId('evaluation-tab-cases')).toBeInTheDocument();
  });

  it('opens the guided setup for a person who may edit', () => {
    navigation.search = 'guided=brief';
    renderEvaluation(true);
    expect(screen.getByTestId('guided-setup')).toBeInTheDocument();
  });

  it('shows a person who may not edit the tabs, even on a guided setup link', () => {
    navigation.search = 'guided=brief';
    renderEvaluation(false);
    expect(screen.queryByTestId('guided-setup')).toBeNull();
    expect(screen.getByTestId('evaluation-tab-cases')).toBeInTheDocument();
  });
});
