import { describe, it, expect } from 'vitest';
import { calculateExpiryRisk } from '../fefo-allocation.js';
import type { Batch } from '../../schemas/batch.js';
import { addWeeks, formatISO } from 'date-fns';

/** Helper to create a batch with sensible defaults */
function makeBatch(
  overrides: Partial<Batch> & Pick<Batch, 'id' | 'quantityOnHand' | 'expiryDate' | 'unitCostCents'>,
): Batch {
  return {
    skuId: 'sku-test',
    warehouseId: 'wh-test',
    lotNumber: 'LOT-TEST',
    manufacturingDate: '2025-01-01',
    ...overrides,
  };
}

/** Reference date for all tests — deterministic */
const REF = new Date('2026-03-02T00:00:00Z');

/** ISO date N weeks from reference */
function weeksFromRef(weeks: number): string {
  return formatISO(addWeeks(REF, weeks), { representation: 'date' });
}

describe('calculateExpiryRisk', () => {
  it('single batch, sufficient demand — zero risk', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'b1',
        quantityOnHand: 100,
        expiryDate: weeksFromRef(10),
        unitCostCents: 500,
      }),
    ];

    const results = calculateExpiryRisk(batches, 15, REF);

    expect(results).toHaveLength(1);
    expect(results[0].batchId).toBe('b1');
    // demand through expiry = 10 * 15 = 150 > 100 → remaining = 0
    expect(results[0].remainingAtExpiry).toBe(0);
    expect(results[0].expiryRiskCents).toBe(0);
  });

  it('single batch, insufficient demand — partial risk', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'b1',
        quantityOnHand: 200,
        expiryDate: weeksFromRef(5),
        unitCostCents: 500,
      }),
    ];

    const results = calculateExpiryRisk(batches, 10, REF);

    expect(results).toHaveLength(1);
    // demand through expiry = 5 * 10 = 50. Remaining = 200 - 50 = 150
    expect(results[0].remainingAtExpiry).toBe(150);
    // risk = 150 * 500 = 75000
    expect(results[0].expiryRiskCents).toBe(75_000);
  });

  it('multiple batches, FEFO ordering — cumulative demand', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'batchB',
        quantityOnHand: 80,
        expiryDate: weeksFromRef(8),
        unitCostCents: 600,
      }),
      makeBatch({
        id: 'batchA',
        quantityOnHand: 100,
        expiryDate: weeksFromRef(4),
        unitCostCents: 500,
      }),
    ];

    const results = calculateExpiryRisk(batches, 20, REF);

    // Should be sorted FEFO: batchA (week 4) first, then batchB (week 8)
    expect(results[0].batchId).toBe('batchA');
    expect(results[1].batchId).toBe('batchB');

    // batchA: demand through week 4 = 80, available = 80 - 0 = 80, consumed = min(100, 80) = 80
    // remaining = 100 - 80 = 20, risk = 20 * 500 = 10000
    expect(results[0].remainingAtExpiry).toBe(20);
    expect(results[0].expiryRiskCents).toBe(10_000);

    // batchB: demand through week 8 = 160, cumulative consumed = 80
    // available for B = 160 - 80 = 80, consumed = min(80, 80) = 80
    // remaining = 80 - 80 = 0, risk = 0
    expect(results[1].remainingAtExpiry).toBe(0);
    expect(results[1].expiryRiskCents).toBe(0);
  });

  it('already expired batch — entire quantity at risk', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'b-expired',
        quantityOnHand: 50,
        expiryDate: weeksFromRef(-2), // 2 weeks ago
        unitCostCents: 1000,
      }),
    ];

    const results = calculateExpiryRisk(batches, 100, REF);

    // weeks until expiry = 0 (clamped), demand through expiry = 0
    // remaining = 50, risk = 50 * 1000 = 50000
    expect(results[0].remainingAtExpiry).toBe(50);
    expect(results[0].expiryRiskCents).toBe(50_000);
  });

  it('zero demand — all batches fully at risk', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'b1',
        quantityOnHand: 100,
        expiryDate: weeksFromRef(10),
        unitCostCents: 200,
      }),
      makeBatch({
        id: 'b2',
        quantityOnHand: 50,
        expiryDate: weeksFromRef(5),
        unitCostCents: 300,
      }),
    ];

    const results = calculateExpiryRisk(batches, 0, REF);

    // b2 sorted first (earlier expiry)
    expect(results[0].batchId).toBe('b2');
    expect(results[0].remainingAtExpiry).toBe(50);
    expect(results[0].expiryRiskCents).toBe(15_000); // 50 * 300

    expect(results[1].batchId).toBe('b1');
    expect(results[1].remainingAtExpiry).toBe(100);
    expect(results[1].expiryRiskCents).toBe(20_000); // 100 * 200
  });

  it('cumulative demand tracking — 3 batches, no double-counting', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'b1',
        quantityOnHand: 40,
        expiryDate: weeksFromRef(2),
        unitCostCents: 100,
      }),
      makeBatch({
        id: 'b2',
        quantityOnHand: 60,
        expiryDate: weeksFromRef(4),
        unitCostCents: 100,
      }),
      makeBatch({
        id: 'b3',
        quantityOnHand: 80,
        expiryDate: weeksFromRef(6),
        unitCostCents: 100,
      }),
    ];

    // weekly demand = 30
    const results = calculateExpiryRisk(batches, 30, REF);

    // b1: weeks=2, demandThrough=60, available=60-0=60, consumed=min(40,60)=40
    //     remaining=0, risk=0, cumulativeDemand=40
    expect(results[0].remainingAtExpiry).toBe(0);
    expect(results[0].expiryRiskCents).toBe(0);

    // b2: weeks=4, demandThrough=120, available=120-40=80, consumed=min(60,80)=60
    //     remaining=0, risk=0, cumulativeDemand=100
    expect(results[1].remainingAtExpiry).toBe(0);
    expect(results[1].expiryRiskCents).toBe(0);

    // b3: weeks=6, demandThrough=180, available=180-100=80, consumed=min(80,80)=80
    //     remaining=0, risk=0, cumulativeDemand=180
    expect(results[2].remainingAtExpiry).toBe(0);
    expect(results[2].expiryRiskCents).toBe(0);
  });

  it('integer precision — non-round unit costs produce exact integers', () => {
    const batches: Batch[] = [
      makeBatch({
        id: 'b1',
        quantityOnHand: 73,
        expiryDate: weeksFromRef(3),
        unitCostCents: 1234,
      }),
    ];

    // weekly demand = 10, weeks = 3, demandThrough = 30
    // available = 30, consumed = 30, remaining = 73 - 30 = 43
    // risk = 43 * 1234 = 53062
    const results = calculateExpiryRisk(batches, 10, REF);

    expect(results[0].remainingAtExpiry).toBe(43);
    expect(results[0].expiryRiskCents).toBe(53_062);
    // Must be exact integer — no floating point
    expect(Number.isInteger(results[0].expiryRiskCents)).toBe(true);
  });
});
