'use client';

import { useMemo } from 'react';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import type { WarehouseAggregation } from '@/lib/risk-aggregations';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';

interface TopWarehousesChartProps {
  data: WarehouseAggregation[];
  loading: boolean;
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

export function TopWarehousesChart({ data, loading }: TopWarehousesChartProps) {
  const chartData = useMemo(() => {
    return data.slice(0, 10).map((wh) => ({
      name:
        wh.warehouseName.length > 20
          ? wh.warehouseName.slice(0, 17) + '...'
          : wh.warehouseName,
      fullName: wh.warehouseName,
      expiryRisk: wh.totalExpiryRiskCents,
      stockoutRisk: wh.totalStockoutRiskCents,
    }));
  }, [data]);

  return (
    <Card data-testid="top-warehouses-chart">
      <CardHeader>
        <CardTitle>Top Risk Warehouses</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[350px] w-full">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ left: 10, right: 10 }}
            >
              <YAxis
                dataKey="name"
                type="category"
                tickLine={false}
                axisLine={false}
                width={120}
                tick={{ fontSize: 12 }}
              />
              <XAxis
                type="number"
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
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
