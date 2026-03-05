// Priority score calculator for draft issues.
// Scores 0-100, higher = more urgent.

import type { RiskConfig } from '@mediforce/supply-intelligence';
import type { RiskRow } from './risk-computations.js';
import { formatEur } from './format-utils.js';

/**
 * Compute a 0-100 priority score for a risk row.
 * Used to rank draft issues for triage.
 */
export function computePriorityScore(row: RiskRow): number {
  let score = 0;

  // Financial impact (0-40 points)
  const totalRiskCents = row.expiryRiskCents + row.stockoutRiskCents;
  if (totalRiskCents >= 1_000_000) score += 40; // >= EUR 10,000
  else if (totalRiskCents >= 500_000) score += 30; // >= EUR 5,000
  else if (totalRiskCents >= 100_000) score += 20; // >= EUR 1,000
  else score += 10;

  // Urgency — nearest expiry (0-30 points)
  if (row.nearestExpiryDays <= 7) score += 30;
  else if (row.nearestExpiryDays <= 14) score += 25;
  else if (row.nearestExpiryDays <= 30) score += 20;
  else if (row.nearestExpiryDays <= 60) score += 10;

  // Stockout imminence (0-20 points)
  if (row.firstStockoutWeek === 1) score += 20;
  else if (row.firstStockoutWeek === 2) score += 15;
  else if (row.firstStockoutWeek !== null) score += 10;

  // Coverage (0-10 points)
  if (row.coverageWeeks <= 1) score += 10;
  else if (row.coverageWeeks <= 2) score += 5;

  return Math.min(100, score);
}

/**
 * Build a human-readable reason string explaining why this item was flagged.
 * All EUR values use formatEur for consistency.
 */
export function buildFlagReason(row: RiskRow, config: RiskConfig): string {
  const reasons: string[] = [];

  if (row.expiryRiskCents >= config.expiryRedThresholdCents) {
    reasons.push(
      `expiry risk (${formatEur(row.expiryRiskCents)}) exceeds red threshold (${formatEur(config.expiryRedThresholdCents)})`,
    );
  }
  if (row.stockoutRiskCents >= config.stockoutRedThresholdCents) {
    reasons.push(
      `stockout risk (${formatEur(row.stockoutRiskCents)}) exceeds red threshold (${formatEur(config.stockoutRedThresholdCents)})`,
    );
  }
  if (
    row.nearestExpiryDays <= config.urgentExpiryDays &&
    row.expiryRiskCents > 0
  ) {
    reasons.push(
      `nearest batch expires in ${row.nearestExpiryDays} days (urgent threshold: ${config.urgentExpiryDays} days)`,
    );
  }
  if (
    row.firstStockoutWeek !== null &&
    row.firstStockoutWeek <= config.urgentStockoutWeeks &&
    row.stockoutRiskCents > 0
  ) {
    reasons.push(
      `stockout projected in week ${row.firstStockoutWeek} (urgent threshold: week ${config.urgentStockoutWeeks})`,
    );
  }

  return reasons.length > 0
    ? `Flagged because ${reasons.join('; ')}`
    : 'Flagged due to combined risk factors exceeding red classification';
}
