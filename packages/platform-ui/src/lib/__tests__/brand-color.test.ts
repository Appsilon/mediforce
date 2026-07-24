import { describe, it, expect } from 'vitest';
import { brandTokenTriples, hexToHslTriple, readableForegroundTriple } from '../brand-color';

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

describe('brandTokenTriples', () => {
  it('passes the color through untouched when no bounds apply', () => {
    expect(brandTokenTriples('#0d9488')).toEqual({
      color: '175 84% 32%',
      foreground: '0 0% 100%',
    });
  });

  it('lifts a dark brand color to the dark-mode minimum lightness', () => {
    // #0d9488 is 32% light — unreadable on a dark background without the lift.
    const dark = brandTokenTriples('#0d9488', { minLightness: 55 });
    expect(dark?.color).toBe('175 84% 55%');
  });

  it('leaves an already-light color alone at the same bound', () => {
    // #5eead4 is 64% light, above the floor, so it must not be pulled down.
    expect(brandTokenTriples('#5eead4', { minLightness: 55 })?.color).toBe('171 77% 64%');
  });

  it('clamps a saturated color into the dark hover-surface band', () => {
    const accent = brandTokenTriples('#f59e0b', {
      maxSaturation: 33,
      minLightness: 14,
      maxLightness: 20,
    });
    expect(accent?.color).toBe('38 33% 20%');
  });

  it('derives the foreground from the adjusted color, not the input', () => {
    // Amber alone reads as "light" (dark text), but clamped to a 20%-lightness
    // hover surface it needs white text.
    expect(readableForegroundTriple('#f59e0b')).toBe('222 47% 11%');
    expect(
      brandTokenTriples('#f59e0b', { maxSaturation: 33, minLightness: 14, maxLightness: 20 })
        ?.foreground,
    ).toBe('0 0% 100%');
  });

  it('returns null for invalid, empty, or nullish input', () => {
    expect(brandTokenTriples('')).toBeNull();
    expect(brandTokenTriples('teal')).toBeNull();
    expect(brandTokenTriples(undefined)).toBeNull();
    expect(brandTokenTriples(null)).toBeNull();
  });
});
