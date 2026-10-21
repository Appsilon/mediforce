import { describe, expect, it } from 'vitest';
import { parseIsoDurationMs } from '../iso-duration';

describe('parseIsoDurationMs', () => {
  it.each([
    ['P14D', 14 * 24 * 60 * 60 * 1000],
    ['P1W', 7 * 24 * 60 * 60 * 1000],
    ['PT2H30M', (2 * 60 + 30) * 60 * 1000],
    ['PT45S', 45 * 1000],
    ['P1DT1H', 25 * 60 * 60 * 1000],
    ['PT0S', 0],
  ])('reads %s', (text, expected) => {
    expect(parseIsoDurationMs(text)).toBe(expected);
  });

  it.each(['', 'P', 'PT', 'P1DT', '14D', 'P1Y', 'P2M', 'PT1.5H', 'P-1D', '2026-10-22T00:00:00Z'])(
    'refuses %s',
    (text) => {
      expect(parseIsoDurationMs(text)).toBeNull();
    },
  );
});
