import {
  SKUS,
  WAREHOUSES,
  BATCHES,
  DEMAND_FORECASTS,
  INBOUND_SHIPMENTS,
  DEFAULT_RISK_CONFIG,
} from '../../../../packages/supply-intelligence/src/seed/seed-data';

export function buildSupplySeedData() {
  const collections: Record<string, Record<string, Record<string, unknown>>> = {};

  collections.riskConfig = { [DEFAULT_RISK_CONFIG.id]: { ...DEFAULT_RISK_CONFIG } };

  collections.skus = {};
  for (const sku of SKUS) collections.skus[sku.id] = { ...sku };

  collections.warehouses = {};
  for (const wh of WAREHOUSES) collections.warehouses[wh.id] = { ...wh };

  collections.batches = {};
  for (const batch of BATCHES) collections.batches[batch.id] = { ...batch };

  collections.demandForecasts = {};
  for (const fc of DEMAND_FORECASTS) collections.demandForecasts[fc.id] = { ...fc };

  collections.inboundShipments = {};
  for (const ship of INBOUND_SHIPMENTS) collections.inboundShipments[ship.id] = { ...ship };

  return collections;
}
