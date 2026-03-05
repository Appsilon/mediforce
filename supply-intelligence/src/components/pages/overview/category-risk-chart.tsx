'use client';

import { useMemo } from 'react';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import type { CategoryAggregation } from '@/lib/risk-aggregations';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';

interface CategoryRiskChartProps {
  data: CategoryAggregation[];
  loading: boolean;
  categorySummaries?: Map<string, { narrative: string; generatedAt: string }>;
}

const chartConfig = {
  expiryRisk: {
    label: 'Expiry Risk',
    color: 'var(--chart-1)',
  },
  stockoutRisk: {
    label: 'Stockout Risk',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig;

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function CategoryRiskChart({ data, loading, categorySummaries }: CategoryRiskChartProps) {
  const chartData = useMemo(() => {
    return data.map((cat) => ({
      name: capitalizeFirst(cat.category),
      expiryRisk: cat.totalExpiryRiskCents,
      stockoutRisk: cat.totalStockoutRiskCents,
    }));
  }, [data]);

  return (
    <Card data-testid="category-risk-chart">
      <CardHeader>
        <CardTitle>Risk by Product Category</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-end gap-4 pt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1"
                style={{ height: `${80 + Math.random() * 120}px` }}
              />
            ))}
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[350px] w-full">
              <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={(value: number) => formatEur(value)}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => {
                        const label =
                          name === 'expiryRisk' ? 'Expiry Risk' : 'Stockout Risk';
                        return `${label}: ${formatEur(value as number)}`;
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="expiryRisk"
                  stackId="risk"
                  fill="var(--color-expiryRisk)"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="stockoutRisk"
                  stackId="risk"
                  fill="var(--color-stockoutRisk)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
            {categorySummaries && categorySummaries.size > 0 && (
              <div className="mt-4 space-y-3">
                {data.map((cat) => {
                  const summary = categorySummaries.get(cat.category);
                  if (!summary) return null;
                  return (
                    <div key={cat.category} className="rounded-lg border p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {capitalizeFirst(cat.category)}
                      </p>
                      <p className="text-sm leading-relaxed">{summary.narrative}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(summary.generatedAt), { addSuffix: true })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
