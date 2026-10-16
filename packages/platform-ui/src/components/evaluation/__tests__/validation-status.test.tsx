import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkflowVersionValidation } from '@mediforce/platform-api/contract';
import { VersionValidationBadge } from '../validation-status';

const passed = { status: 'passed', evalRunId: null, reason: 'Eval Run 1a2b3c4d met its Acceptance Criteria.', runInProgress: false } as const;

function version(steps: WorkflowVersionValidation['steps']): WorkflowVersionValidation {
  return { definitionVersion: 2, status: 'passed', steps };
}

describe('VersionValidationBadge', () => {
  it('says a version is verified through the agents its steps run as they are', () => {
    render(<VersionValidationBadge handle="acme" workflowName="safety" version={version([
      { stepId: 'grade-aes', stepName: 'Grade AEs', validation: { ...passed, inheritedFromAgent: { agentId: 'ae-grader', name: 'AE grader', version: 3 } } },
      { stepId: 'summarise', stepName: 'Summarise', validation: passed },
    ])} />);

    const badge = screen.getByTestId('version-validation-badge');
    expect(badge).toHaveTextContent('Verified via agent');
    expect(badge).toHaveAttribute('title', "Grade AEs: validation passed via agent 'AE grader' v3 · Summarise: validation passed");
  });

  it('says plain Verified when every step was run on its own', () => {
    render(<VersionValidationBadge handle="acme" workflowName="safety" version={version([
      { stepId: 'summarise', stepName: 'Summarise', validation: passed },
    ])} />);

    expect(screen.getByTestId('version-validation-badge')).toHaveTextContent(/^Verified$/);
  });
});
