import { differenceInWeeks } from 'date-fns';
import type { Batch } from '../schemas/batch.js';

/**
 * Result of FEFO expiry risk calculation for a single batch.
 */
export interface ExpiryRiskResult {
  /** Batch identifier */
  batchId: string;
  /** Units that will not be consumed before expiry */
  remainingAtExpiry: number;
  /** Financial risk in EUR cents: remainingAtExpiry * unitCostCents */
  expiryRiskCents: number;
}

/**
 * Calculate expiry risk for a set of batches using FEFO (First-Expiry-First-Out)
 * allocation against forecast weekly demand.
 *
 * Batches are sorted by expiry date ascending. Demand is allocated cumulatively
 * starting from the earliest-expiring batch. Remaining quantity after demand
 * allocation represents units at risk of expiring unsold.
 *
 * All monetary values are integer cents — no floating-point arithmetic.
 *
 * @param batches      - Batches to evaluate (any order — will be sorted internally)
 * @param weeklyDemand - Forecast weekly demand in units
 * @param referenceDate - Date to calculate weeks from (defaults to now)
 * @returns Per-batch expiry risk results, sorted by expiry date ascending
 */
export function calculateExpiryRisk(
  batches: Batch[],
  weeklyDemand: number,
  referenceDate: Date = new Date(),
): ExpiryRiskResult[] {
  // Sort by expiry date ascending (FEFO)
  const sorted = [...batches].sort(
    (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
  );

  const results: ExpiryRiskResult[] = [];
  let cumulativeDemandConsumed = 0;

  for (const batch of sorted) {
    const batchExpiry = new Date(batch.expiryDate);

    // Weeks until expiry — clamped to zero for already-expired batches
    const weeksUntilExpiry = Math.max(0, differenceInWeeks(batchExpiry, referenceDate));

    // Total demand that can be fulfilled through this batch's expiry window
    const demandThroughExpiry = weeksUntilExpiry * weeklyDemand;

    // Available demand for this batch = total demand minus what earlier batches consumed
    const availableForBatch = Math.max(0, demandThroughExpiry - cumulativeDemandConsumed);

    // Consume as much of this batch as possible
    const consumed = Math.min(batch.quantityOnHand, availableForBatch);
    const remaining = batch.quantityOnHand - consumed;

    // Integer * integer = integer (no floating-point contamination)
    const expiryRiskCents = remaining * batch.unitCostCents;

    results.push({
      batchId: batch.id,
      remainingAtExpiry: remaining,
      expiryRiskCents,
    });

    // Track cumulative demand consumed for next batch
    cumulativeDemandConsumed += consumed;
  }

  return results;
}
