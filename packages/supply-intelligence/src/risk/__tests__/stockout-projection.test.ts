import { describe, it, expect } from 'vitest';
import { calculateStockoutRisk } from '../stockout-projection.js';

/** Reference date for all tests — deterministic */
const REF = new Date('2026-03-02T00:00:00Z');

describe('calculateStockoutRisk', () => {
  it('no stockout — sufficient inventory for all 4 weeks', () => {
    const result = calculateStockoutRisk(
      400,                    // currentOnHand
      [100, 100, 100, 100],  // weeklyDemands
      [0, 0, 0, 0],          // inboundByWeek
      500,                    // avgUnitCostCents
      REF,
    );

    expect(result.projections).toHaveLength(4);
    expect(result.projections[0].endingInventory).toBe(300);
    expect(result.projections[1].endingInventory).toBe(200);
    expect(result.projections[2].endingInventory).toBe(100);
    expect(result.projections[3].endingInventory).toBe(0);
    expect(result.shortfallUnits).toBe(0);
    expect(result.stockoutRiskCents).toBe(0);
    expect(result.firstStockoutWeek).toBeNull();
  });

  it('stockout in week 3 — negative inventory clamped', () => {
    const result = calculateStockoutRisk(
      200,                    // currentOnHand
      [100, 100, 100, 100],  // weeklyDemands
      [0, 0, 0, 0],          // inboundByWeek
      500,                    // avgUnitCostCents
      REF,
    );

    expect(result.projections).toHaveLength(4);
    // Week 1: 200 - 100 = 100
    expect(result.projections[0].endingInventory).toBe(100);
    // Week 2: 100 - 100 = 0
    expect(result.projections[1].endingInventory).toBe(0);
    // Week 3: starts at 0 (clamped), 0 - 100 = -100
    expect(result.projections[2].startingInventory).toBe(0);
    expect(result.projections[2].endingInventory).toBe(-100);
    // Week 4: starts at 0 (clamped from -100), 0 - 100 = -100
    expect(result.projections[3].startingInventory).toBe(0);
    expect(result.projections[3].endingInventory).toBe(-100);

    // Total shortfall: 100 (week 3) + 100 (week 4) = 200
    expect(result.shortfallUnits).toBe(200);
    expect(result.stockoutRiskCents).toBe(200 * 500);
    expect(result.firstStockoutWeek).toBe(3);
  });

  it('inbound prevents some stockout but not all', () => {
    const result = calculateStockoutRisk(
      50,                     // currentOnHand
      [100, 100, 100, 100],  // weeklyDemands
      [0, 150, 0, 0],        // inboundByWeek
      500,                    // avgUnitCostCents
      REF,
    );

    // Week 1: 50 + 0 - 100 = -50 → shortfall 50, carry 0
    expect(result.projections[0].endingInventory).toBe(-50);
    // Week 2: 0 + 150 - 100 = 50
    expect(result.projections[1].startingInventory).toBe(0);
    expect(result.projections[1].endingInventory).toBe(50);
    // Week 3: 50 + 0 - 100 = -50 → shortfall 50, carry 0
    expect(result.projections[2].endingInventory).toBe(-50);
    // Week 4: 0 + 0 - 100 = -100 → shortfall 100, carry 0
    expect(result.projections[3].endingInventory).toBe(-100);

    // Total shortfall: 50 + 50 + 100 = 200
    expect(result.shortfallUnits).toBe(200);
    expect(result.stockoutRiskCents).toBe(200 * 500);
    expect(result.firstStockoutWeek).toBe(1);
  });

  it('negative inventory clamping — next week starts at 0', () => {
    // Specifically test that negative inventory does not propagate
    const result = calculateStockoutRisk(
      10,                     // currentOnHand
      [100, 50, 50, 50],     // weeklyDemands
      [0, 0, 0, 0],          // inboundByWeek
      100,                    // avgUnitCostCents
      REF,
    );

    // Week 1: 10 - 100 = -90 → shortfall 90, carry 0
    expect(result.projections[0].endingInventory).toBe(-90);
    // Week 2: starts at 0 (NOT -90), 0 - 50 = -50 → shortfall 50
    expect(result.projections[1].startingInventory).toBe(0);
    expect(result.projections[1].endingInventory).toBe(-50);
    // Week 3: starts at 0, 0 - 50 = -50 → shortfall 50
    expect(result.projections[2].startingInventory).toBe(0);
    // Week 4: starts at 0, 0 - 50 = -50 → shortfall 50
    expect(result.projections[3].startingInventory).toBe(0);

    // Total shortfall: 90 + 50 + 50 + 50 = 240
    expect(result.shortfallUnits).toBe(240);
    expect(result.stockoutRiskCents).toBe(240 * 100);
  });

  it('integer precision — non-round avgUnitCostCents', () => {
    const result = calculateStockoutRisk(
      50,
      [100, 100, 100, 100],
      [0, 0, 0, 0],
      3456,                   // non-round cost
      REF,
    );

    // Week 1: 50 - 100 = -50, shortfall = 50
    // Week 2-4: start at 0, -100 each, shortfall = 300
    // Total shortfall = 350
    expect(result.shortfallUnits).toBe(350);
    expect(result.stockoutRiskCents).toBe(350 * 3456);
    expect(result.stockoutRiskCents).toBe(1_209_600);
    expect(Number.isInteger(result.stockoutRiskCents)).toBe(true);
  });

  it('seasonal demand variation — different demand per week', () => {
    const result = calculateStockoutRisk(
      300,
      [120, 80, 150, 90],    // seasonal variation
      [0, 0, 0, 0],
      500,
      REF,
    );

    // Week 1: 300 - 120 = 180
    expect(result.projections[0].endingInventory).toBe(180);
    // Week 2: 180 - 80 = 100
    expect(result.projections[1].endingInventory).toBe(100);
    // Week 3: 100 - 150 = -50 → shortfall 50
    expect(result.projections[2].endingInventory).toBe(-50);
    // Week 4: 0 - 90 = -90 → shortfall 90
    expect(result.projections[3].endingInventory).toBe(-90);

    expect(result.shortfallUnits).toBe(140);
    expect(result.stockoutRiskCents).toBe(140 * 500);
    expect(result.firstStockoutWeek).toBe(3);
  });

  it('zero demand — no stockout possible', () => {
    const result = calculateStockoutRisk(
      100,
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      500,
      REF,
    );

    expect(result.shortfallUnits).toBe(0);
    expect(result.stockoutRiskCents).toBe(0);
    expect(result.firstStockoutWeek).toBeNull();
    // All ending inventories should be 100
    for (const p of result.projections) {
      expect(p.endingInventory).toBe(100);
    }
  });

  it('projections include correct week numbers and dates', () => {
    const result = calculateStockoutRisk(
      100,
      [25, 25, 25, 25],
      [0, 0, 0, 0],
      500,
      REF,
    );

    expect(result.projections[0].week).toBe(1);
    expect(result.projections[1].week).toBe(2);
    expect(result.projections[2].week).toBe(3);
    expect(result.projections[3].week).toBe(4);

    // Each weekStartDate should be a valid ISO date string
    for (const p of result.projections) {
      expect(p.weekStartDate).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});
