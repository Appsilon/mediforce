'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useSupplyData } from '@/hooks/use-supply-data';
import { useAgentSummaries } from '@/hooks/use-agent-summaries';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SkuHeader } from '@/components/pages/sku-detail/sku-header';
import { ExpiryTab } from '@/components/pages/sku-detail/expiry-tab';
import { StockoutTab } from '@/components/pages/sku-detail/stockout-tab';
import { Button } from '@/components/ui/button';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function SkuDetailPage() {
  const params = useParams<{ skuId: string }>();
  const searchParams = useSearchParams();
  const skuId = params.skuId;
  const warehouseId = searchParams.get('warehouse');

  const { skus, warehouses, batches, riskRows, loading } = useSupplyData();
  const { getSkuPairSummary } = useAgentSummaries();

  // Find the matching risk row for this SKU+warehouse pair
  const riskRow = useMemo(() => {
    if (!warehouseId) return undefined;
    return riskRows.find((r) => r.skuId === skuId && r.warehouseId === warehouseId);
  }, [riskRows, skuId, warehouseId]);

  // Filter batches to this SKU+warehouse pair
  const filteredBatches = useMemo(() => {
    if (!warehouseId) return [];
    return batches.filter((b) => b.skuId === skuId && b.warehouseId === warehouseId);
  }, [batches, skuId, warehouseId]);

  // Get AI summary for this SKU+warehouse pair
  const skuSummary = useMemo(
    () => (skuId && warehouseId ? getSkuPairSummary(skuId, warehouseId) : undefined),
    [getSkuPairSummary, skuId, warehouseId],
  );

  // Look up SKU and warehouse names
  const sku = useMemo(() => skus.find((s) => s.id === skuId), [skus, skuId]);
  const warehouse = useMemo(
    () => warehouses.find((w) => w.id === warehouseId),
    [warehouses, warehouseId],
  );

  // Missing warehouse param
  if (!warehouseId) {
    return (
      <div className="space-y-6">
        <BackNavigation />
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertTriangle className="h-5 w-5" />
              <p>No warehouse specified. <Link href="/operational" className="underline text-primary">Go back to Operational View</Link>.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <BackNavigation />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // SKU+warehouse not found
  if (!riskRow) {
    return (
      <div className="space-y-6">
        <BackNavigation />
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertTriangle className="h-5 w-5" />
              <p>SKU+Warehouse pair not found. <Link href="/operational" className="underline text-primary">Go back to Operational View</Link>.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackNavigation />

      <SkuHeader
        riskRow={riskRow}
        skuName={sku?.name ?? riskRow.skuName}
        warehouseName={warehouse?.name ?? riskRow.warehouseName}
        loading={false}
        aiSummary={
          skuSummary
            ? { narrative: skuSummary.narrative, generatedAt: skuSummary.generatedAt }
            : null
        }
      />

      <Tabs defaultValue="expiry" className="w-full">
        <TabsList>
          <TabsTrigger value="expiry">Expiry Risk</TabsTrigger>
          <TabsTrigger value="stockout">Stockout Risk</TabsTrigger>
        </TabsList>
        <TabsContent value="expiry">
          <ExpiryTab
            batches={filteredBatches}
            expiryResults={riskRow.expiryRiskResults}
            loading={false}
          />
        </TabsContent>
        <TabsContent value="stockout">
          <StockoutTab
            stockoutResult={riskRow.stockoutResult}
            loading={false}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackNavigation() {
  return (
    <div className="flex items-center gap-4">
      <Link href="/operational">
        <Button variant="ghost" size="icon">
          <ArrowLeft />
        </Button>
      </Link>
      <h1 className="text-3xl font-bold font-headline">SKU Detail</h1>
    </div>
  );
}
