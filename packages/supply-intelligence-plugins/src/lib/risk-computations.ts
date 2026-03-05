// Re-implements the risk row computation pipeline from
// supply-intelligence/src/lib/risk-aggregations.ts using the
// @mediforce/supply-intelligence package risk functions.
// This avoids importing from the Next.js app.

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

// ─── RiskRow type ───────────────────────────────────────────────────────────

export interface RiskRow {
  skuId: string;
  warehouseId: string;
  skuName: string;
  warehouseName: string;
  country: string;
  category: TherapeuticCategory;
  riskLevel: RiskLevel;
  onHand: number;
  monthlyDemand: number;
  coverageWeeks: number;
  expiryRiskCents: number;
  stockoutRiskCents: number;
  nearestExpiryDays: number;
  firstStockoutWeek: number | null;
  batchCount: number;
  expiryRiskResults: ExpiryRiskResult[];
  stockoutResult: StockoutRiskResult;
}

// ─── Aggregation types ──────────────────────────────────────────────────────

export interface OverviewKpis {
  totalExpiryRiskCents: number;
  totalStockoutRiskCents: number;
  totalPairs: number;
  redCount: number;
  orangeCount: number;
  greenCount: number;
  redPercentage: number;
  batchesUnder90Days: number;
}

export interface CategoryAggregation {
  category: TherapeuticCategory;
  totalExpiryRiskCents: number;
  totalStockoutRiskCents: number;
  pairCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildWeeklyDemands(
  forecasts: DemandForecast[],
  defaultWeeklyDemand: number,
  referenceDate: Date,
): number[] {
  const result = [
    defaultWeeklyDemand,
    defaultWeeklyDemand,
    defaultWeeklyDemand,
    defaultWeeklyDemand,
  ];

  for (let w = 0; w < 4; w++) {
    const weekStart = startOfWeek(addWeeks(referenceDate, w), {
      weekStartsOn: 1,
    });
    const weekEnd = addWeeks(weekStart, 1);

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

function buildInboundByWeek(
  shipments: InboundShipment[],
  referenceDate: Date,
): number[] {
  const result = [0, 0, 0, 0];

  for (const s of shipments) {
    const arrivalDate = new Date(s.expectedArrivalDate);

    for (let w = 0; w < 4; w++) {
      const weekStart = startOfWeek(addWeeks(referenceDate, w), {
        weekStartsOn: 1,
      });
      const weekEnd = addWeeks(weekStart, 1);

      if (!isBefore(arrivalDate, weekStart) && isBefore(arrivalDate, weekEnd)) {
        result[w] += s.quantity;
        break;
      }
    }
  }

  return result;
}

function computeWeightedAvgCost(
  batches: Batch[],
  fallbackCostCents: number,
): number {
  const totalQty = batches.reduce((sum, b) => sum + b.quantityOnHand, 0);
  if (totalQty === 0) return fallbackCostCents;

  const totalValue = batches.reduce(
    (sum, b) => sum + b.quantityOnHand * b.unitCostCents,
    0,
  );
  return Math.round(totalValue / totalQty);
}

function computeNearestExpiryDays(
  batches: Batch[],
  referenceDate: Date,
): number {
  let nearest = Infinity;
  for (const batch of batches) {
    const expiryDate = new Date(batch.expiryDate);
    const days = differenceInDays(expiryDate, referenceDate);
    const clamped = Math.max(0, days);
    if (clamped < nearest) nearest = clamped;
  }
  return nearest === Infinity ? 999 : nearest;
}

// ─── Main computation ───────────────────────────────────────────────────────

export function computeAllRiskRows(
  skus: Sku[],
  warehouses: Warehouse[],
  batches: Batch[],
  shipments: InboundShipment[],
  forecasts: DemandForecast[],
  config: RiskConfig,
  referenceDate: Date = new Date(),
): RiskRow[] {
  const skuMap = new Map<string, Sku>();
  for (const sku of skus) skuMap.set(sku.id, sku);

  const warehouseMap = new Map<string, Warehouse>();
  for (const wh of warehouses) warehouseMap.set(wh.id, wh);

  const batchesByPair = new Map<string, Batch[]>();
  for (const batch of batches) {
    const key = `${batch.skuId}|${batch.warehouseId}`;
    const arr = batchesByPair.get(key);
    if (arr) arr.push(batch);
    else batchesByPair.set(key, [batch]);
  }

  const shipmentsByPair = new Map<string, InboundShipment[]>();
  for (const s of shipments) {
    if (s.status !== 'confirmed') continue;
    const key = `${s.skuId}|${s.warehouseId}`;
    const arr = shipmentsByPair.get(key);
    if (arr) arr.push(s);
    else shipmentsByPair.set(key, [s]);
  }

  const forecastsByPair = new Map<string, DemandForecast[]>();
  for (const f of forecasts) {
    const key = `${f.skuId}|${f.warehouseId}`;
    const arr = forecastsByPair.get(key);
    if (arr) arr.push(f);
    else forecastsByPair.set(key, [f]);
  }

  const rows: RiskRow[] = [];

  for (const [key, pairBatches] of batchesByPair) {
    const [skuId, warehouseId] = key.split('|');
    const sku = skuMap.get(skuId);
    const warehouse = warehouseMap.get(warehouseId);
    if (!sku || !warehouse) continue;

    const weeklyDemand = Math.round(sku.monthlyDemand / 4);
    const expiryResults = calculateExpiryRisk(
      pairBatches,
      weeklyDemand,
      referenceDate,
    );
    const expiryRiskCents = expiryResults.reduce(
      (sum, r) => sum + r.expiryRiskCents,
      0,
    );

    const currentOnHand = pairBatches.reduce(
      (sum, b) => sum + b.quantityOnHand,
      0,
    );

    const pairForecasts = forecastsByPair.get(key) ?? [];
    const weeklyDemands = buildWeeklyDemands(
      pairForecasts,
      weeklyDemand,
      referenceDate,
    );

    const pairShipments = shipmentsByPair.get(key) ?? [];
    const inboundByWeek = buildInboundByWeek(pairShipments, referenceDate);
    const avgUnitCostCents = computeWeightedAvgCost(
      pairBatches,
      sku.unitCostCents,
    );

    const stockoutResult = calculateStockoutRisk(
      currentOnHand,
      weeklyDemands,
      inboundByWeek,
      avgUnitCostCents,
      referenceDate,
    );

    const nearestExpiryDays = computeNearestExpiryDays(
      pairBatches,
      referenceDate,
    );

    const riskLevel = classifyRisk(
      expiryRiskCents,
      stockoutResult.stockoutRiskCents,
      nearestExpiryDays,
      stockoutResult.firstStockoutWeek,
      config,
    );

    const coverageWeeks =
      weeklyDemand > 0 ? Math.floor(currentOnHand / weeklyDemand) : 999;

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

// ─── Aggregation functions ──────────────────────────────────────────────────

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
  const redPercentage =
    totalPairs > 0 ? Math.round((redCount / totalPairs) * 1000) / 10 : 0;

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
