import type { RiskConfig, RiskLevel } from '../schemas/risk-config.js';

/**
 * Classify combined risk into Red/Orange/Green based on configurable thresholds.
 *
 * Classification logic (evaluated in order):
 * 1. RED if either risk exceeds its red threshold
 * 2. RED if urgency trigger fires AND corresponding risk is non-zero
 * 3. ORANGE if either risk exceeds its orange threshold
 * 4. GREEN otherwise
 *
 * Urgency triggers require non-zero risk to fire — an item with zero risk
 * but soon-expiring batches is not classified as red (there's nothing at risk).
 *
 * @param expiryRiskCents    - Total expiry risk in EUR cents
 * @param stockoutRiskCents  - Total stockout risk in EUR cents
 * @param nearestExpiryDays  - Days until the nearest batch expires
 * @param firstStockoutWeek  - First week with stockout (1-4), or null if none
 * @param config             - Risk threshold configuration
 * @returns Risk level: 'red', 'orange', or 'green'
 */
export function classifyRisk(
  expiryRiskCents: number,
  stockoutRiskCents: number,
  nearestExpiryDays: number,
  firstStockoutWeek: number | null,
  config: RiskConfig,
): RiskLevel {
  // Red: either risk above red threshold
  if (expiryRiskCents >= config.expiryRedThresholdCents) return 'red';
  if (stockoutRiskCents >= config.stockoutRedThresholdCents) return 'red';

  // Red: urgency triggers (only if there's actual risk)
  if (nearestExpiryDays <= config.urgentExpiryDays && expiryRiskCents > 0) return 'red';
  if (
    firstStockoutWeek !== null &&
    firstStockoutWeek <= config.urgentStockoutWeeks &&
    stockoutRiskCents > 0
  ) {
    return 'red';
  }

  // Orange: either risk above orange threshold
  if (expiryRiskCents >= config.expiryOrangeThresholdCents) return 'orange';
  if (stockoutRiskCents >= config.stockoutOrangeThresholdCents) return 'orange';

  return 'green';
}
