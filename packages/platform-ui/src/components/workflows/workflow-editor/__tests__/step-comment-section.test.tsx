import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowStep } from '@mediforce/platform-core';
import { StepCommentSection, commentAfterVerdictRename, commentAfterVerdictDelete } from '../step-comment-section';

const humanStep: WorkflowStep = {
  id: 'review',
  name: 'Review',
  type: 'review',
  executor: 'human',
  verdicts: { approve: { target: 'done' }, revise: { target: 'draft', requiresComment: true } },
};

const agentStep: WorkflowStep = { id: 'draft', name: 'Draft', type: 'creation', executor: 'agent', autonomyLevel: 'L3' };

const box = (verdict: string) => screen.getByRole('checkbox', { name: `Comment required for ${verdict}` }) as HTMLInputElement;

describe('StepCommentSection', () => {
  it('shows what the task will require, including the revise default', () => {
    render(<StepCommentSection step={agentStep} onChange={vi.fn()} />);
    expect(box('approve').checked).toBe(false);
    expect(box('revise').checked).toBe(true);
  });

  it('can turn off a comment an agent review requires by default', () => {
    const onChange = vi.fn();
    render(<StepCommentSection step={agentStep} onChange={onChange} />);
    fireEvent.click(box('revise'));
    expect(onChange).toHaveBeenCalledWith({ comment: { requiredForVerdicts: [] } });
  });

  it('moves the verdict-level requirement into the step setting when edited', () => {
    const onChange = vi.fn();
    render(<StepCommentSection step={humanStep} onChange={onChange} />);
    fireEvent.click(box('approve'));
    expect(onChange).toHaveBeenCalledWith({
      comment: { requiredForVerdicts: ['approve', 'revise'] },
      verdicts: { approve: { target: 'done' }, revise: { target: 'draft' } },
    });
  });

  it('offers approve and revise on a human step with no verdicts, whose form shows both', () => {
    const onChange = vi.fn();
    render(<StepCommentSection step={{ ...humanStep, verdicts: undefined }} onChange={onChange} />);
    expect(box('approve').checked).toBe(false);
    fireEvent.click(box('revise'));
    expect(onChange).toHaveBeenCalledWith({ comment: { requiredForVerdicts: [] } });
  });

  it('renders nothing when the task has no comment box', () => {
    const { container } = render(
      <StepCommentSection step={{ ...humanStep, verdicts: undefined, params: [{ name: 'reason', type: 'string', required: false }] }} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('verdict edits keep the comment setting in step', () => {
  it('follows a renamed verdict', () => {
    expect(commentAfterVerdictRename({ requiredForVerdicts: ['revise'] }, 'revise', 'rework')).toEqual({ requiredForVerdicts: ['rework'] });
  });

  it('drops a deleted verdict', () => {
    expect(commentAfterVerdictDelete({ requiredForVerdicts: ['revise', 'reject'] }, 'revise')).toEqual({ requiredForVerdicts: ['reject'] });
  });

  it('stays unset when the step has no setting', () => {
    expect(commentAfterVerdictRename(undefined, 'revise', 'rework')).toBeUndefined();
    expect(commentAfterVerdictDelete(undefined, 'revise')).toBeUndefined();
  });
});
