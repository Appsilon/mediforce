import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerificationLadder } from '../verification-ladder';

describe('VerificationLadder', () => {
  it('[RENDER] names all four rungs and the question each one answers', () => {
    render(<VerificationLadder activeRung="schema" />);

    expect(screen.getByText('Schema validation')).toBeInTheDocument();
    expect(screen.getByText('Workflow readiness check')).toBeInTheDocument();
    expect(screen.getByText('Dry Run')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();

    expect(screen.getByText('Is the definition legal?')).toBeInTheDocument();
    expect(
      screen.getByText('Are the image, secrets, model and credits it needs present?'),
    ).toBeInTheDocument();
    expect(screen.getByText('Is the workflow structured as I intended?')).toBeInTheDocument();
    expect(screen.getByText('Does the work produce what I wanted?')).toBeInTheDocument();
  });

  it('[RENDER] marks earlier rungs as passed, the active rung as current, later rungs as pending', () => {
    render(<VerificationLadder activeRung="readiness" />);

    expect(screen.getByTestId('rung-schema')).toHaveAttribute('data-state', 'passed');
    expect(screen.getByTestId('rung-readiness')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('rung-dry-run')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('rung-run')).toHaveAttribute('data-state', 'pending');
  });

  it('[RENDER] falls back to a static hint for readiness when no live result is supplied', () => {
    render(<VerificationLadder activeRung="schema" />);
    expect(screen.getByText('Runs before a run starts.')).toBeInTheDocument();
  });

  it('[RENDER] reports a clear live readiness result', () => {
    render(<VerificationLadder activeRung="readiness" readiness="clear" />);
    expect(screen.getByText('All present.')).toBeInTheDocument();
  });

  it('[RENDER] reports the live readiness warning count', () => {
    render(<VerificationLadder activeRung="readiness" readiness={{ warnings: 3 }} />);
    expect(screen.getByText('3 warnings above.')).toBeInTheDocument();
  });

  it('[RENDER] singularises a lone readiness warning', () => {
    render(<VerificationLadder activeRung="readiness" readiness={{ warnings: 1 }} />);
    expect(screen.getByText('1 warning above.')).toBeInTheDocument();
  });

  it('[RENDER] reports readiness still checking', () => {
    render(<VerificationLadder activeRung="readiness" readiness="checking" />);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  it('[RENDER] links out to the verification guide', () => {
    render(<VerificationLadder activeRung="schema" />);
    const link = screen.getByRole('link', { name: /which check answers which question/i });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Appsilon/mediforce/blob/main/docs/how-to/verify-a-workflow.md',
    );
  });
});
