import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildProcessInstance, buildStepExecution } from '@mediforce/platform-core/testing';
import type { Step } from '@mediforce/platform-core';
import { createQueryWrapper } from '@/test/react-query';
import { StepStatusPanel } from '../step-status-panel';

const steps: Step[] = [{ id: 'fetch-data', name: 'Fetch data', type: 'action' }];

describe('StepStatusPanel row expand', () => {
  it('hides the output value until the row expands, and keeps it out of the Details block', async () => {
    const user = userEvent.setup();
    const instance = buildProcessInstance({ status: 'completed', currentStepId: null });
    const execution = buildStepExecution({
      stepId: 'fetch-data',
      status: 'completed',
      output: { recordCount: 42 },
    });

    const { wrapper } = createQueryWrapper();
    render(
      <StepStatusPanel
        instance={instance}
        definitionSteps={steps}
        stepExecutions={[execution]}
        stepConfigMap={new Map([['fetch-data', { executorType: 'script', timeoutMinutes: 5 }]])}
      />,
      { wrapper },
    );

    // A script row, not an agent row — it still has to be expandable.
    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.queryByText(/42/)).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/42/)).toBeInTheDocument();

    await user.click(screen.getByText('Details'));
    const detailsEl = screen.getByText('Timeout').closest('details');
    expect(detailsEl).not.toBeNull();
    expect(detailsEl?.textContent).not.toMatch(/42/);
  });

  it('labels a databricks-job step as Databricks, not Script, in the history row', () => {
    const instance = buildProcessInstance({ status: 'completed', currentStepId: null });
    const execution = buildStepExecution({ stepId: 'fetch-data', status: 'completed', output: {} });

    const { wrapper } = createQueryWrapper();
    render(
      <StepStatusPanel
        instance={instance}
        definitionSteps={steps}
        stepExecutions={[execution]}
        stepConfigMap={new Map([['fetch-data', { executorType: 'script', plugin: 'databricks-job' }]])}
      />,
      { wrapper },
    );

    expect(screen.getAllByText('Databricks').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Script')).not.toBeInTheDocument();
  });
});
