'use client';

import { useMemo } from 'react';
import { useCollection } from '@/hooks/use-collection';
import { computeAllRiskRows } from '@/lib/risk-aggregations';
import type {
  Sku,
  Warehouse,
  Batch,
  InboundShipment,
  DemandForecast,
  RiskConfig,
} from '@mediforce/supply-intelligence';
import { DEFAULT_RISK_CONFIG } from '@mediforce/supply-intelligence';

/**
 * Central data hook that fetches all Firestore collections and computes
 * risk rows for every SKU+warehouse pair.
 *
 * Consumers get typed domain data plus a computed `riskRows` array
 * ready for rendering in Overview, Operational, and SKU Detail views.
 */
export function useSupplyData() {
  const { data: skus, loading: skuLoading } = useCollection<Sku>('skus');
  const { data: warehouses, loading: whLoading } = useCollection<Warehouse>('warehouses');
  const { data: batches, loading: batchLoading } = useCollection<Batch>('batches');
  const { data: shipments, loading: shipLoading } = useCollection<InboundShipment>('inboundShipments');
  const { data: forecasts, loading: forecastLoading } = useCollection<DemandForecast>('demandForecasts');
  const { data: configs, loading: configLoading } = useCollection<RiskConfig>('riskConfig');

  const loading = skuLoading || whLoading || batchLoading || shipLoading || forecastLoading || configLoading;
  const config = configs[0] ?? DEFAULT_RISK_CONFIG;

  const riskRows = useMemo(() => {
    if (loading) return [];
    return computeAllRiskRows(skus, warehouses, batches, shipments, forecasts, config);
  }, [skus, warehouses, batches, shipments, forecasts, config, loading]);

  return { skus, warehouses, batches, shipments, forecasts, config, riskRows, loading };
}
