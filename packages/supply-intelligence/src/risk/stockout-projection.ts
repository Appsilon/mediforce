import { addWeeks, startOfWeek, formatISO } from 'date-fns';

/**
 * Week-by-week inventory projection for a single week.
 */
export interface WeekProjection {
  /** Week number (1-4) */
  week: number;
  /** ISO date string for the start of this week */
  weekStartDate: string;
  /** Inventory at the start of the week (clamped to >= 0 from previous week) */
  startingInventory: number;
  /** Forecast demand for this week */
  demand: number;
  /** Confirmed inbound arriving this week */
  inbound: number;
  /** Ending inventory: startingInventory + inbound - demand (may be negative) */
  endingInventory: number;
}

/**
 * Result of 4-week stockout risk projection.
 */
export interface StockoutRiskResult {
  /** Week-by-week projection details */
  projections: WeekProjection[];
  /** Total shortfall units across all weeks (sum of absolute negative endings) */
  shortfallUnits: number;
  /** Financial risk in EUR cents: shortfallUnits * avgUnitCostCents */
  stockoutRiskCents: number;
  /** First week number (1-4) where ending inventory goes negative, or null */
  firstStockoutWeek: number | null;
}

/**
 * Calculate 4-week stockout risk projection for a SKU+warehouse pair.
 *
 * Projects inventory forward week by week, accounting for demand and confirmed
 * inbound shipments. Negative ending inventory indicates stockout — the shortfall
 * is valued in EUR cents.
 *
 * Key behavior: When ending inventory goes negative, the next week starts at 0
 * (not at the negative value). This prevents compounding error from propagating
 * artificial shortfalls into subsequent weeks.
 *
 * All monetary values are integer cents — no floating-point arithmetic.
 *
 * @param currentOnHand   - Current inventory on hand (units)
 * @param weeklyDemands   - Forecast demand per week [week1, week2, week3, week4]
 * @param inboundByWeek   - Confirmed inbound per week [week1, week2, week3, week4]
 * @param avgUnitCostCents - Average unit cost in EUR cents
 * @param referenceDate   - Date to start projections from (defaults to now)
 * @returns Stockout risk result with projections and financial risk
 */
export function calculateStockoutRisk(
  currentOnHand: number,
  weeklyDemands: number[],
  inboundByWeek: number[],
  avgUnitCostCents: number,
  referenceDate: Date = new Date(),
): StockoutRiskResult {
  const projections: WeekProjection[] = [];
  let inventory = currentOnHand;
  let totalShortfall = 0;
  let firstStockoutWeek: number | null = null;

  for (let w = 0; w < 4; w++) {
    const starting = inventory;
    const demand = weeklyDemands[w] ?? 0;
    const inbound = inboundByWeek[w] ?? 0;
    const ending = starting + inbound - demand;

    // Calculate the start date for this week
    const weekStart = startOfWeek(addWeeks(referenceDate, w), { weekStartsOn: 1 });
    const weekStartDate = formatISO(weekStart, { representation: 'date' });

    projections.push({
      week: w + 1,
      weekStartDate,
      startingInventory: starting,
      demand,
      inbound,
      endingInventory: ending,
    });

    if (ending < 0) {
      totalShortfall += Math.abs(ending);
      if (firstStockoutWeek === null) {
        firstStockoutWeek = w + 1;
      }
      // Clamp to zero for next week's starting inventory
      inventory = 0;
    } else {
      inventory = ending;
    }
  }

  // Integer * integer = integer (no floating-point contamination)
  const stockoutRiskCents = totalShortfall * avgUnitCostCents;

  return {
    projections,
    shortfallUnits: totalShortfall,
    stockoutRiskCents,
    firstStockoutWeek,
  };
}
