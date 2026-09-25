import { describe, it, expect } from 'vitest';
import { DEFAULT_DRIFT_SETTINGS, detectDrift, parseDriftSettings } from '../drift';

const settings = { window: 4, threshold: 0.25 };

describe('detectDrift', () => {
  it('alerts on a sustained drop of at least the threshold', () => {
    // Newest first: the last four failed half the time, the four before all passed.
    const drift = detectDrift([0, 1, 0, 1, 1, 1, 1, 1], settings);
    expect(drift).toEqual({ recentMean: 0.5, baselineMean: 1, recentCount: 4, baselineCount: 4, drifting: true });
  });

  it('counts a drop exactly at the threshold', () => {
    expect(detectDrift([1, 1, 1, 0, 1, 1, 1, 1], settings).drifting).toBe(true);
  });

  it('does not alert on a smaller drop or a rise', () => {
    expect(detectDrift([1, 1, 1, 0.5, 1, 1, 1, 1], settings).drifting).toBe(false);
    expect(detectDrift([1, 1, 1, 1, 0, 0, 0, 0], settings).drifting).toBe(false);
  });

  it('does not judge until both windows are full', () => {
    const drift = detectDrift([0, 0, 0, 0, 1, 1, 1], settings);
    expect(drift.baselineMean).toBeNull();
    expect(drift.baselineCount).toBe(3);
    expect(drift.drifting).toBe(false);
    expect(detectDrift([0, 0], settings).recentMean).toBeNull();
  });

  it('ignores Scores older than two windows', () => {
    expect(detectDrift([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], settings).drifting).toBe(false);
  });
});

describe('parseDriftSettings', () => {
  it('takes valid values', () => {
    expect(parseDriftSettings('50', '0.1')).toEqual({ window: 50, threshold: 0.1 });
  });

  it('falls back to the defaults for unset or unusable values', () => {
    expect(parseDriftSettings(undefined, undefined)).toEqual(DEFAULT_DRIFT_SETTINGS);
    expect(parseDriftSettings('', '')).toEqual(DEFAULT_DRIFT_SETTINGS);
    expect(parseDriftSettings('1', '0')).toEqual(DEFAULT_DRIFT_SETTINGS);
    expect(parseDriftSettings('2.5', '1.5')).toEqual(DEFAULT_DRIFT_SETTINGS);
    expect(parseDriftSettings('many', 'lots')).toEqual(DEFAULT_DRIFT_SETTINGS);
  });
});
