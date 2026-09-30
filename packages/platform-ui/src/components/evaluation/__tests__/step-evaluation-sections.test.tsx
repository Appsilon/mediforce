import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefSection } from '../step-evaluation-sections';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: () => ({ mutate: vi.fn(), isPending: false }),
}),);

vi.mock('@/lib/mediforce', () => ({
  mediforce: { evaluation: { setBrief: vi.fn() } },
}));

describe('BriefSection', () => {
  it('renders the Evaluation Brief as Markdown', () => {
    render(
      <BriefSection
        step={{ namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' }}
        data={{
          isLoading: false,
          data: {
            brief: {
              namespace: 'acme',
              workflowName: 'safety',
              stepId: 'grade-aes',
              version: 1,
              text: 'A **critical** check.',
              origin: 'user',
              createdBy: 'author-1',
              createdAt: '2026-09-24T08:00:00.000Z',
            },
          },
        } as never}
        mayEdit={false}
      />,
    );

    expect(screen.getByText('critical').tagName).toBe('STRONG');
    expect(screen.queryByText('A **critical** check.')).toBeNull();
  });
});
