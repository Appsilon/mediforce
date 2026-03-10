import { differenceInDays, addWeeks, startOfWeek, isBefore } from 'date-fns';
import type {
  Sku,
  Warehouse,
  Batch,
  InboundShipment,
  DemandForecast,
  RiskConfig,
  RiskLevel,
  TherapeuticCategory,
  ExpiryRiskResult,
  StockoutRiskResult,
} from '@mediforce/supply-intelligence';
import {
  calculateExpiryRisk,
  calculateStockoutRisk,
  classifyRisk,
} from '@mediforce/supply-intelligence';

/**
 * Central data type consumed by ALL view components (Overview, Operational, SKU Detail).
 * One row per SKU+warehouse pair that has at least one batch.
 */
export interface RiskRow {
  skuId: string;
  warehouseId: string;
  skuName: string;
  warehouseName: string;
  country: string;
  category: TherapeuticCategory;
  riskLevel: RiskLevel;
  /** Total units on hand for this SKU+WH pair */
  onHand: number;
  /** From SKU schema */
  monthlyDemand: number;
  /** onHand / weeklyDemand (integer, clamped) */
  coverageWeeks: number;
  /** Sum of batch-level FEFO expiry risk */
  expiryRiskCents: number;
  /** From 4-week stockout projection */
  stockoutRiskCents: number;
  /** Days until nearest batch expires */
  nearestExpiryDays: number;
  /** First week with stockout (1-4) or null */
  firstStockoutWeek: number | null;
  /** Number of batches for this pair */
  batchCount: number;
  /** Per-batch expiry results (for SKU Detail) */
  expiryRiskResults: ExpiryRiskResult[];
  /** Full projection (for SKU Detail) */
  stockoutResult: StockoutRiskResult;
}

/**
 * Compute risk rows for every SKU+warehouse pair that has at least one batch.
 *
 * Pipeline:
 * 1. Build lookup maps
 * 2. Group batches/shipments/forecasts by composite key
 * 3. For each pair: FEFO expiry risk + stockout projection + classification
 */
export function computeAllRiskRows(
  skus: Sku[],
  warehouses: Warehouse[],
  batches: Batch[],
  shipments: InboundShipment[],
  forecasts: DemandForecast[],
  config: RiskConfig,
  referenceDate: Date = new Date(),
): RiskRow[] {
  // 1. Build lookup maps
  const skuMap = new Map<string, Sku>();
  for (const sku of skus) skuMap.set(sku.id, sku);

  const warehouseMap = new Map<string, Warehouse>();
  for (const wh of warehouses) warehouseMap.set(wh.id, wh);

  // 2. Group batches by composite key
  const batchesByPair = new Map<string, Batch[]>();
  for (const batch of batches) {
    const key = `${batch.skuId}|${batch.warehouseId}`;
    const arr = batchesByPair.get(key);
    if (arr) {
      arr.push(batch);
    } else {
      batchesByPair.set(key, [batch]);
    }
  }

  // Group shipments by composite key (confirmed only)
  const shipmentsByPair = new Map<string, InboundShipment[]>();
  for (const s of shipments) {
    if (s.status !== 'confirmed') continue;
    const key = `${s.skuId}|${s.warehouseId}`;
    const arr = shipmentsByPair.get(key);
    if (arr) {
      arr.push(s);
    } else {
      shipmentsByPair.set(key, [s]);
    }
  }

  // Group forecasts by composite key
  const forecastsByPair = new Map<string, DemandForecast[]>();
  for (const f of forecasts) {
    const key = `${f.skuId}|${f.warehouseId}`;
    const arr = forecastsByPair.get(key);
    if (arr) {
      arr.push(f);
    } else {
      forecastsByPair.set(key, [f]);
    }
  }

  // 3. Process each pair
  const rows: RiskRow[] = [];

  for (const [key, pairBatches] of batchesByPair) {
    const [skuId, warehouseId] = key.split('|');
    const sku = skuMap.get(skuId);
    const warehouse = warehouseMap.get(warehouseId);
    if (!sku || !warehouse) continue;

    // a. Weekly demand
    const weeklyDemand = Math.round(sku.monthlyDemand / 4);

    // b. FEFO expiry risk
    const expiryResults = calculateExpiryRisk(pairBatches, weeklyDemand, referenceDate);
    const expiryRiskCents = expiryResults.reduce((sum, r) => sum + r.expiryRiskCents, 0);

    // c. Current on-hand
    const currentOnHand = pairBatches.reduce((sum, b) => sum + b.quantityOnHand, 0);

    // d. Build weeklyDemands array from forecasts (4 weeks)
    const pairForecasts = forecastsByPair.get(key) ?? [];
    const weeklyDemands = buildWeeklyDemands(pairForecasts, weeklyDemand, referenceDate);

    // e. Build inboundByWeek array from confirmed shipments
    const pairShipments = shipmentsByPair.get(key) ?? [];
    const inboundByWeek = buildInboundByWeek(pairShipments, referenceDate);

    // f. Average unit cost (weighted by quantity, fallback to sku.unitCostCents)
    const avgUnitCostCents = computeWeightedAvgCost(pairBatches, sku.unitCostCents);

    // g. Stockout risk projection
    const stockoutResult = calculateStockoutRisk(
      currentOnHand,
      weeklyDemands,
      inboundByWeek,
      avgUnitCostCents,
      referenceDate,
    );

    // h. Nearest expiry days
    const nearestExpiryDays = computeNearestExpiryDays(pairBatches, referenceDate);

    // i. Risk classification
    const riskLevel = classifyRisk(
      expiryRiskCents,
      stockoutResult.stockoutRiskCents,
      nearestExpiryDays,
      stockoutResult.firstStockoutWeek,
      config,
    );

    // j. Coverage weeks
    const coverageWeeks = weeklyDemand > 0 ? Math.floor(currentOnHand / weeklyDemand) : 999;

    rows.push({
      skuId,
      warehouseId,
      skuName: sku.name,
      warehouseName: warehouse.name,
      country: warehouse.country,
      category: sku.category,
      riskLevel,
      onHand: currentOnHand,
      monthlyDemand: sku.monthlyDemand,
      coverageWeeks,
      expiryRiskCents,
      stockoutRiskCents: stockoutResult.stockoutRiskCents,
      nearestExpiryDays,
      firstStockoutWeek: stockoutResult.firstStockoutWeek,
      batchCount: pairBatches.length,
      expiryRiskResults: expiryResults,
      stockoutResult,
    });
  }

  return rows;
}

/**
 * Build a 4-week demand array from forecasts, falling back to default weekly demand.
 */
function buildWeeklyDemands(
  forecasts: DemandForecast[],
  defaultWeeklyDemand: number,
  referenceDate: Date,
): number[] {
  const result: number[] = [defaultWeeklyDemand, defaultWeeklyDemand, defaultWeeklyDemand, defaultWeeklyDemand];

  for (let w = 0; w < 4; w++) {
    const weekStart = startOfWeek(addWeeks(referenceDate, w), { weekStartsOn: 1 });
    const weekEnd = addWeeks(weekStart, 1);

    // Find forecast that matches this week
    const match = forecasts.find((f) => {
      const fDate = new Date(f.weekStartDate);
      return !isBefore(fDate, weekStart) && isBefore(fDate, weekEnd);
    });

    if (match) {
      result[w] = match.demandUnits;
    }
  }

  return result;
}

/**
 * Build a 4-week inbound array from confirmed shipments.
 */
function buildInboundByWeek(
  shipments: InboundShipment[],
  referenceDate: Date,
): number[] {
  const result = [0, 0, 0, 0];

  for (const s of shipments) {
    const arrivalDate = new Date(s.expectedArrivalDate);

    for (let w = 0; w < 4; w++) {
      const weekStart = startOfWeek(addWeeks(referenceDate, w), { weekStartsOn: 1 });
      const weekEnd = addWeeks(weekStart, 1);

      if (!isBefore(arrivalDate, weekStart) && isBefore(arrivalDate, weekEnd)) {
        result[w] += s.quantity;
        break;
      }
    }
  }

  return result;
}

/**
 * Weighted average unit cost across batches. Integer result (rounded).
 */
function computeWeightedAvgCost(batches: Batch[], fallbackCostCents: number): number {
  const totalQty = batches.reduce((sum, b) => sum + b.quantityOnHand, 0);
  if (totalQty === 0) return fallbackCostCents;

  const totalValue = batches.reduce((sum, b) => sum + b.quantityOnHand * b.unitCostCents, 0);
  return Math.round(totalValue / totalQty);
}

/**
 * Minimum days until any batch in the set expires. Clamped to 0 for expired batches.
 */
function computeNearestExpiryDays(batches: Batch[], referenceDate: Date): number {
  let nearest = Infinity;
  for (const batch of batches) {
    const expiryDate = new Date(batch.expiryDate);
    const days = differenceInDays(expiryDate, referenceDate);
    const clamped = Math.max(0, days);
    if (clamped < nearest) nearest = clamped;
  }
  return nearest === Infinity ? 999 : nearest;
}

// ---------- Aggregation functions ----------

export interface OverviewKpis {
  totalExpiryRiskCents: number;
  totalStockoutRiskCents: number;
  totalPairs: number;
  redCount: number;
  orangeCount: number;
  greenCount: number;
  redPercentage: number;
  /** Count of pairs with nearest expiry within 90 days */
  batchesUnder90Days: number;
}

/**
 * Aggregate KPI totals from risk rows. Integer-cent arithmetic only.
 */
export function computeOverviewKpis(riskRows: RiskRow[]): OverviewKpis {
  let totalExpiryRiskCents = 0;
  let totalStockoutRiskCents = 0;
  let redCount = 0;
  let orangeCount = 0;
  let greenCount = 0;
  let batchesUnder90Days = 0;

  for (const row of riskRows) {
    totalExpiryRiskCents += row.expiryRiskCents;
    totalStockoutRiskCents += row.stockoutRiskCents;

    if (row.riskLevel === 'red') redCount++;
    else if (row.riskLevel === 'orange') orangeCount++;
    else greenCount++;

    if (row.nearestExpiryDays <= 90) batchesUnder90Days++;
  }

  const totalPairs = riskRows.length;
  const redPercentage = totalPairs > 0
    ? Math.round((redCount / totalPairs) * 1000) / 10
    : 0;

  return {
    totalExpiryRiskCents,
    totalStockoutRiskCents,
    totalPairs,
    redCount,
    orangeCount,
    greenCount,
    redPercentage,
    batchesUnder90Days,
  };
}

export interface WarehouseAggregation {
  warehouseId: string;
  warehouseName: string;
  country: string;
  totalExpiryRiskCents: number;
  totalStockoutRiskCents: number;
  totalRiskCents: number;
  pairCount: number;
}

/**
 * Aggregate risk rows by warehouse. Sorted by totalRiskCents descending.
 */
export function aggregateByWarehouse(riskRows: RiskRow[]): WarehouseAggregation[] {
  const map = new Map<string, WarehouseAggregation>();

  for (const row of riskRows) {
    const existing = map.get(row.warehouseId);
    if (existing) {
      existing.totalExpiryRiskCents += row.expiryRiskCents;
      existing.totalStockoutRiskCents += row.stockoutRiskCents;
      existing.totalRiskCents += row.expiryRiskCents + row.stockoutRiskCents;
      existing.pairCount++;
    } else {
      map.set(row.warehouseId, {
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        country: row.country,
        totalExpiryRiskCents: row.expiryRiskCents,
        totalStockoutRiskCents: row.stockoutRiskCents,
        totalRiskCents: row.expiryRiskCents + row.stockoutRiskCents,
        pairCount: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalRiskCents - a.totalRiskCents);
}

export interface CategoryAggregation {
  category: TherapeuticCategory;
  totalExpiryRiskCents: number;
  totalStockoutRiskCents: number;
  pairCount: number;
}

/**
 * Aggregate risk rows by therapeutic category. One entry per category.
 */
export function aggregateByCategory(riskRows: RiskRow[]): CategoryAggregation[] {
  const map = new Map<TherapeuticCategory, CategoryAggregation>();

  for (const row of riskRows) {
    const existing = map.get(row.category);
    if (existing) {
      existing.totalExpiryRiskCents += row.expiryRiskCents;
      existing.totalStockoutRiskCents += row.stockoutRiskCents;
      existing.pairCount++;
    } else {
      map.set(row.category, {
        category: row.category,
        totalExpiryRiskCents: row.expiryRiskCents,
        totalStockoutRiskCents: row.stockoutRiskCents,
        pairCount: 1,
      });
    }
  }

  return Array.from(map.values());
}
