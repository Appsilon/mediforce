import { describe, it, expect } from 'vitest';
import { hexToHslTriple, readableForegroundTriple } from '../brand-color';

describe('hexToHslTriple', () => {
  it('converts primary/secondary colors to HSL triples', () => {
    expect(hexToHslTriple('#000000')).toBe('0 0% 0%');
    expect(hexToHslTriple('#ffffff')).toBe('0 0% 100%');
    expect(hexToHslTriple('#ff0000')).toBe('0 100% 50%');
    expect(hexToHslTriple('#00ff00')).toBe('120 100% 50%');
    expect(hexToHslTriple('#0000ff')).toBe('240 100% 50%');
  });

  it('handles a real brand teal', () => {
    // #0d9488 ≈ teal-600
    expect(hexToHslTriple('#0d9488')).toBe('175 84% 32%');
  });

  it('accepts uppercase hex', () => {
    expect(hexToHslTriple('#FF0000')).toBe('0 100% 50%');
  });

  it('returns null for invalid, empty, or nullish input', () => {
    expect(hexToHslTriple('')).toBeNull();
    expect(hexToHslTriple('teal')).toBeNull();
    expect(hexToHslTriple('#fff')).toBeNull();
    expect(hexToHslTriple('0d9488')).toBeNull();
    expect(hexToHslTriple(undefined)).toBeNull();
    expect(hexToHslTriple(null)).toBeNull();
  });
});

describe('readableForegroundTriple', () => {
  it('picks dark text on light backgrounds and white on dark', () => {
    expect(readableForegroundTriple('#ffffff')).toBe('222 47% 11%');
    expect(readableForegroundTriple('#f59e0b')).toBe('222 47% 11%');
    expect(readableForegroundTriple('#000000')).toBe('0 0% 100%');
    expect(readableForegroundTriple('#0d9488')).toBe('0 0% 100%');
  });

  it('returns null for invalid input', () => {
    expect(readableForegroundTriple('')).toBeNull();
    expect(readableForegroundTriple('nope')).toBeNull();
  });
});
