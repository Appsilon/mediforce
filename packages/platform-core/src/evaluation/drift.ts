/**
 * Drift alerts (ADR-0023, research § Drift): a production Evaluator's rolling
 * Score average compared with the window before it. A drop of at least
 * `threshold` over two full windows is an alert; anything shorter is not
 * judged, so a handful of early failures never raises one.
 */
export interface DriftSettings {
  /** Production Scores per window. */
  readonly window: number;
  /** Drop in the mean Score (0–1) that raises an alert. */
  readonly threshold: number;
}

export const DEFAULT_DRIFT_SETTINGS: DriftSettings = { window: 20, threshold: 0.15 };

export interface DriftWindows {
  /** Mean of the newest `window` Scores; null until there are that many. */
  readonly recentMean: number | null;
  /** Mean of the `window` Scores before them; null until there are that many. */
  readonly baselineMean: number | null;
  readonly recentCount: number;
  readonly baselineCount: number;
  readonly drifting: boolean;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** `values` newest first, as Scores are listed. */
export function detectDrift(values: readonly number[], settings: DriftSettings): DriftWindows {
  const recent = values.slice(0, settings.window);
  const baseline = values.slice(settings.window, settings.window * 2);
  const recentMean = recent.length === settings.window ? mean(recent) : null;
  const baselineMean = baseline.length === settings.window ? mean(baseline) : null;
  const drifting = recentMean !== null && baselineMean !== null
    // A hair of tolerance so 0.9 − 0.75 counts as the 0.15 it is.
    && baselineMean - recentMean >= settings.threshold - 1e-9;
  return { recentMean, baselineMean, recentCount: recent.length, baselineCount: baseline.length, drifting };
}

/**
 * The deployment's defaults from `MEDIFORCE_DRIFT_WINDOW` (an integer 2–500)
 * and `MEDIFORCE_DRIFT_THRESHOLD` (0–1, exclusive of 0). Unset or unusable
 * values fall back to the default, never fail the boot.
 */
export function parseDriftSettings(window: string | undefined, threshold: string | undefined): DriftSettings {
  const parsedWindow = Number(window);
  const parsedThreshold = Number(threshold);
  return {
    window: window !== undefined && window !== '' && Number.isInteger(parsedWindow) && parsedWindow >= 2 && parsedWindow <= 500
      ? parsedWindow
      : DEFAULT_DRIFT_SETTINGS.window,
    threshold: threshold !== undefined && threshold !== '' && parsedThreshold > 0 && parsedThreshold <= 1
      ? parsedThreshold
      : DEFAULT_DRIFT_SETTINGS.threshold,
  };
}
