import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigList } from '../config-list';

describe('ConfigList', () => {
  it('[RENDER] renders stub message about embedded configs', () => {
    render(<ConfigList processName="supply-chain-review" />);
    expect(screen.getByText(/embedded in workflow definitions/i)).toBeInTheDocument();
  });
});
