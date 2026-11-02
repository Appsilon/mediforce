import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ParamsForm } from '../params-form';

vi.mock('@/lib/mediforce', () => ({ mediforce: { tasks: { complete: vi.fn() } } }));

describe('ParamsForm', () => {
  it('does not block a task with no verdicts on a param required only for a verdict', () => {
    render(<ParamsForm taskId="t1" params={[{ name: 'reason', type: 'string', required: false, requiredForVerdicts: ['reject'] }]} />);
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
  });

  it('blocks it on a required param', () => {
    render(<ParamsForm taskId="t1" params={[{ name: 'reason', type: 'string', required: true }]} />);
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });
});
