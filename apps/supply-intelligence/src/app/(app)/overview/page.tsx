'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSupplyData } from '@/hooks/use-supply-data';
import { useAgentSummaries } from '@/hooks/use-agent-summaries';
import {
  computeOverviewKpis,
  aggregateByWarehouse,
  aggregateByCategory,
} from '@/lib/risk-aggregations';
import { triggerAnalysis } from '@/lib/agent-trigger';
import { KpiCards } from '@/components/pages/overview/kpi-cards';
import { TopWarehousesChart } from '@/components/pages/overview/top-warehouses-chart';
import { CategoryRiskChart } from '@/components/pages/overview/category-risk-chart';
import { AiSummaryCard } from '@/components/pages/overview/ai-summary-card';

export default function OverviewPage() {
  const { riskRows, loading } = useSupplyData();
  const {
    getOverviewSummary,
    getCategorySummary,
    isStale,
    loading: summariesLoading,
  } = useAgentSummaries();

  const [reanalyzing, setReanalyzing] = useState(false);

  const kpis = useMemo(() => computeOverviewKpis(riskRows), [riskRows]);
  const warehouseData = useMemo(
    () => aggregateByWarehouse(riskRows),
    [riskRows],
  );
  const categoryData = useMemo(
    () => aggregateByCategory(riskRows),
    [riskRows],
  );

  const overviewSummary = getOverviewSummary();

  const categorySummaryMap = useMemo(() => {
    const map = new Map<string, { narrative: string; generatedAt: string }>();
    for (const cat of categoryData) {
      const summary = getCategorySummary(cat.category);
      if (summary) {
        map.set(cat.category, {
          narrative: summary.narrative,
          generatedAt: summary.generatedAt,
        });
      }
    }
    return map;
  }, [categoryData, getCategorySummary]);

  async function handleReanalyze() {
    setReanalyzing(true);
    try {
      await triggerAnalysis();
    } catch (e) {
      console.error('Analysis trigger failed:', e);
    } finally {
      setReanalyzing(false);
    }
  }

  useEffect(() => {
    if (!summariesLoading && isStale && !reanalyzing) {
      handleReanalyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summariesLoading, isStale]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold font-headline">Overview</h1>
      <KpiCards kpis={kpis} loading={loading} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopWarehousesChart data={warehouseData} loading={loading} />
        <CategoryRiskChart
          data={categoryData}
          loading={loading}
          categorySummaries={categorySummaryMap}
        />
      </div>
      <AiSummaryCard
        narrative={overviewSummary?.narrative ?? null}
        generatedAt={overviewSummary?.generatedAt ?? null}
        loading={summariesLoading}
        onReanalyze={handleReanalyze}
        reanalyzing={reanalyzing}
      />
    </div>
  );
}
