import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssistantPlan, answersMessage } from '../assistant-plan';

const plan = {
  plan: ['Poll the SFTP server every 15 minutes', 'Validate each delivery with a carried script'],
  questions: [
    { id: 'sftp-secret', question: 'Which secret holds the SFTP password?', recommended: 'SFTP_PASS_CDISCPILOT01' },
    { id: 'reviewer', question: 'Who reviews the report?', recommended: 'the data-manager role' },
  ],
  phases: ['Writing the validation script'],
};

describe('AssistantPlan', () => {
  it('says what it would build, in the order it said it', () => {
    render(<AssistantPlan plan={plan} answers={{}} onAnswer={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Poll the SFTP server every 15 minutes')).toBeInTheDocument();
    expect(screen.getByText('Validate each delivery with a carried script')).toBeInTheDocument();
  });

  it('prefills each question with the answer it would have used', () => {
    // Agreeing has to be one click. A blank field would hand the decision back,
    // which is the interrogation this card exists to avoid.
    render(<AssistantPlan plan={plan} answers={{}} onAnswer={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Which secret holds the SFTP password?')).toHaveValue('SFTP_PASS_CDISCPILOT01');
    expect(screen.getByLabelText('Who reviews the report?')).toHaveValue('the data-manager role');
  });

  it('reports an edited answer', () => {
    const onAnswer = vi.fn();
    render(<AssistantPlan plan={plan} answers={{}} onAnswer={onAnswer} onBuild={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Who reviews the report?'), { target: { value: 'the qa role' } });
    expect(onAnswer).toHaveBeenCalledWith('reviewer', 'the qa role');
  });

  it('builds on the button, and drops the plan on cancel', () => {
    const onBuild = vi.fn();
    const onCancel = vi.fn();
    render(<AssistantPlan plan={plan} answers={{}} onAnswer={vi.fn()} onBuild={onBuild} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /build with these answers/i }));
    expect(onBuild).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('answersMessage', () => {
  it('sends the recommended answer for anything left alone', () => {
    expect(answersMessage(plan, {})).toBe(
      'Which secret holds the SFTP password? SFTP_PASS_CDISCPILOT01\nWho reviews the report? the data-manager role',
    );
  });

  it('sends what the person typed instead', () => {
    expect(answersMessage(plan, { reviewer: 'the qa role' })).toContain('Who reviews the report? the qa role');
  });
});

// The same card carries a build that could not finish: no plan, just what it
// needs to know. A toast there would say the turn is over and leave the person
// nothing to act on.
describe('AssistantPlan — asking after a build could not finish', () => {
  const stuck = {
    plan: [],
    questions: [{ id: 'which-step', question: 'Which step did you mean?', recommended: 'the review step' }],
    phases: [],
  };

  it('asks rather than announcing a plan it does not have', () => {
    render(<AssistantPlan plan={stuck} answers={{}} onAnswer={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/I need one thing from you/i)).toBeInTheDocument();
    expect(screen.queryByText(/Here is what I would build/i)).toBeNull();
  });

  it('offers to try again rather than to build', () => {
    render(<AssistantPlan plan={stuck} answers={{}} onAnswer={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /try again with this/i })).toBeInTheDocument();
  });
});
