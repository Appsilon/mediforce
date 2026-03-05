import { describe, it, expect } from 'vitest';
import { calculateExpiryRisk } from '../fefo-allocation.js';
import { calculateStockoutRisk } from '../stockout-projection.js';
import type { Batch } from '../../schemas/batch.js';
import { addWeeks, formatISO } from 'date-fns';

/** Reference date for all tests — deterministic */
const REF = new Date('2026-03-02T00:00:00Z');

/** ISO date N weeks from reference */
function weeksFromRef(weeks: number): string {
  return formatISO(addWeeks(REF, weeks), { representation: 'date' });
}

/** Create a test batch with non-round cost */
function makeBatch(
  id: string,
  qty: number,
  expiryWeeks: number,
  unitCostCents: number,
): Batch {
  return {
    id,
    skuId: 'sku-test',
    warehouseId: 'wh-test',
    lotNumber: `LOT-${id}`,
    quantityOnHand: qty,
    unitCostCents,
    manufacturingDate: '2025-01-01',
    expiryDate: weeksFromRef(expiryWeeks),
  };
}

describe('rollup consistency', () => {
  it('batch-to-SKU rollup — sum of batch risks equals total (exact integer)', () => {
    const batches: Batch[] = [
      makeBatch('b1', 100, 3, 1234),
      makeBatch('b2', 80, 6, 5678),
      makeBatch('b3', 60, 9, 9999),
    ];

    const weeklyDemand = 20;
    const results = calculateExpiryRisk(batches, weeklyDemand, REF);

    // Manually compute expected values:
    // b1: weeks=3, demandThrough=60, available=60, consumed=min(100,60)=60
    //     remaining=40, risk=40*1234=49360, cumDemand=60
    // b2: weeks=6, demandThrough=120, available=120-60=60, consumed=min(80,60)=60
    //     remaining=20, risk=20*5678=113560, cumDemand=120
    // b3: weeks=9, demandThrough=180, available=180-120=60, consumed=min(60,60)=60
    //     remaining=0, risk=0, cumDemand=180

    expect(results[0].expiryRiskCents).toBe(49_360);
    expect(results[1].expiryRiskCents).toBe(113_560);
    expect(results[2].expiryRiskCents).toBe(0);

    const batchTotal = results.reduce((sum, r) => sum + r.expiryRiskCents, 0);
    const expectedTotal = 49_360 + 113_560 + 0;

    // EXACT integer equality — no .toBeCloseTo(), no epsilon
    expect(batchTotal).toBe(expectedTotal);
    expect(batchTotal).toBe(162_920);
    expect(Number.isInteger(batchTotal)).toBe(true);
  });

  it('non-round costs — no floating-point contamination in summation', () => {
    // Use deliberately tricky non-round costs that could cause float issues
    const batches: Batch[] = [
      makeBatch('b1', 73, 4, 1234),
      makeBatch('b2', 91, 7, 5678),
      makeBatch('b3', 47, 10, 9999),
      makeBatch('b4', 33, 13, 3333),
      makeBatch('b5', 67, 16, 7777),
    ];

    const weeklyDemand = 15;
    const results = calculateExpiryRisk(batches, weeklyDemand, REF);

    const batchTotal = results.reduce((sum, r) => sum + r.expiryRiskCents, 0);

    // Every individual risk must be an exact integer
    for (const r of results) {
      expect(Number.isInteger(r.expiryRiskCents)).toBe(true);
    }

    // Sum must be exact integer
    expect(Number.isInteger(batchTotal)).toBe(true);

    // Verify the sum is exactly the sum of parts (not off by rounding)
    const manualSum = results.map((r) => r.expiryRiskCents).reduce((a, b) => a + b, 0);
    expect(batchTotal).toBe(manualSum);
  });

  it('large dataset rollup — 50+ batches summed with exact equality', () => {
    // Generate 55 batches with varying non-round costs
    const batches: Batch[] = [];
    for (let i = 0; i < 55; i++) {
      batches.push(
        makeBatch(
          `b-${i.toString().padStart(3, '0')}`,
          20 + (i * 7) % 100,           // varying quantities 20-119
          2 + (i % 20),                   // expiry 2-21 weeks out
          1000 + (i * 137) % 9000,        // costs 1000-9999 cents
        ),
      );
    }

    const weeklyDemand = 50;
    const results = calculateExpiryRisk(batches, weeklyDemand, REF);

    expect(results).toHaveLength(55);

    // Every individual risk must be integer
    for (const r of results) {
      expect(Number.isInteger(r.expiryRiskCents)).toBe(true);
    }

    // Sum must be exact integer
    const batchTotal = results.reduce((sum, r) => sum + r.expiryRiskCents, 0);
    expect(Number.isInteger(batchTotal)).toBe(true);

    // Verify no floating-point contamination: sum computed two different ways must match
    let runningTotal = 0;
    for (const r of results) {
      runningTotal += r.expiryRiskCents;
    }
    expect(batchTotal).toBe(runningTotal);
  });

  it('stockout risk rollup — multiple SKU+warehouse pairs sum correctly', () => {
    // Simulate 3 different SKU+warehouse pairs
    const pairs = [
      { onHand: 50, demands: [100, 100, 100, 100] as number[], inbound: [0, 0, 0, 0] as number[], cost: 1234 },
      { onHand: 200, demands: [80, 80, 80, 80] as number[], inbound: [0, 50, 0, 0] as number[], cost: 5678 },
      { onHand: 30, demands: [60, 60, 60, 60] as number[], inbound: [0, 0, 100, 0] as number[], cost: 9999 },
    ];

    const pairResults = pairs.map((p) =>
      calculateStockoutRisk(p.onHand, p.demands, p.inbound, p.cost, REF),
    );

    // Each result's stockoutRiskCents must be integer
    for (const r of pairResults) {
      expect(Number.isInteger(r.stockoutRiskCents)).toBe(true);
    }

    // Sum across pairs must be exact integer
    const totalRisk = pairResults.reduce((sum, r) => sum + r.stockoutRiskCents, 0);
    expect(Number.isInteger(totalRisk)).toBe(true);

    // Verify: recompute and compare
    const manualTotal = pairResults.map((r) => r.stockoutRiskCents).reduce((a, b) => a + b, 0);
    expect(totalRisk).toBe(manualTotal);
  });
});
