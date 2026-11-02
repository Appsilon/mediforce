import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ParamField } from '../param-field';

describe('ParamField required mark', () => {
  it('marks a parameter required for some verdicts', () => {
    render(
      <ParamField
        param={{ name: 'reason', type: 'string', required: false, requiredForVerdicts: ['revise'] }}
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('leaves an optional parameter unmarked', () => {
    render(<ParamField param={{ name: 'reason', type: 'string', required: false }} value="" onChange={vi.fn()} />);
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });
});
