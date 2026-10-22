import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkflowVersionValidation } from '@mediforce/platform-api/contract';
import { VersionValidationBadge } from '../validation-status';

const passed = { status: 'passed', evalRunId: null, reason: 'Eval Run 1a2b3c4d met its Acceptance Criteria.', runInProgress: false } as const;

function version(steps: WorkflowVersionValidation['steps']): WorkflowVersionValidation {
  return { definitionVersion: 2, status: 'passed', steps };
}

describe('VersionValidationBadge', () => {
  it('links to the step validated on its own, even when an inherited step comes first', () => {
    render(<VersionValidationBadge handle="acme" workflowName="safety" version={version([
      { stepId: 'grade-aes', stepName: 'Grade AEs', validation: { ...passed, inheritedFromAgent: { agentId: 'ae-grader', name: 'AE grader', version: 3 } } },
      { stepId: 'summarise', stepName: 'Summarise', validation: passed },
    ])} />);

    const badge = screen.getByTestId('version-validation-badge');
    expect(badge).toHaveTextContent('Verified via agent');
    expect(badge).toHaveAttribute('title', "Grade AEs: validation passed via agent 'AE grader' v3 · Summarise: validation passed");
    expect(badge).toHaveAttribute('href', '/acme/workflows/safety?tab=evaluation&version=2&step=summarise');
  });

  it('links to the agent only when every passed step is inherited', () => {
    render(<VersionValidationBadge handle="acme" workflowName="safety" version={version([
      { stepId: 'grade-aes', stepName: 'Grade AEs', validation: { ...passed, inheritedFromAgent: { agentId: 'ae-grader', name: 'AE grader', version: 3 } } },
      { stepId: 'summarise', stepName: 'Summarise', validation: { ...passed, inheritedFromAgent: { agentId: 'summariser', name: 'Summariser', version: 1 } } },
    ])} />);

    expect(screen.getByTestId('version-validation-badge')).toHaveAttribute('href', '/acme/agents/definitions/ae-grader?tab=evaluation');
  });

  it('says plain Verified when every step was run on its own', () => {
    render(<VersionValidationBadge handle="acme" workflowName="safety" version={version([
      { stepId: 'summarise', stepName: 'Summarise', validation: passed },
    ])} />);

    expect(screen.getByTestId('version-validation-badge')).toHaveTextContent(/^Verified$/);
    expect(screen.getByTestId('version-validation-badge')).toHaveAttribute('href', '/acme/workflows/safety?tab=evaluation&version=2&step=summarise');
  });
});
