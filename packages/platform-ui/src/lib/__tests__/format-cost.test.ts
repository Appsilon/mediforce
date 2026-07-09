import { describe, it, expect } from 'vitest';
import { formatCostUsd } from '../format';

describe('formatCostUsd', () => {
  it('shows $0.00 for zero', () => {
    expect(formatCostUsd(0)).toBe('$0.00');
  });

  it('shows 4 decimals for tiny costs (< $0.01)', () => {
    expect(formatCostUsd(0.0034)).toBe('$0.0034');
    expect(formatCostUsd(0.0001)).toBe('$0.0001');
  });

  it('shows 3 decimals for sub-dollar costs', () => {
    expect(formatCostUsd(0.105)).toBe('$0.105');
    expect(formatCostUsd(0.5)).toBe('$0.500');
  });

  it('shows 2 decimals for dollar+ costs', () => {
    expect(formatCostUsd(1.05)).toBe('$1.05');
    expect(formatCostUsd(12.5)).toBe('$12.50');
  });
});
