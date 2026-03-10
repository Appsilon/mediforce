'use client';

import { AlertTriangle, Clock, PackageX } from 'lucide-react';
import type { OverviewKpis } from '@/lib/risk-aggregations';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface KpiCardsProps {
  kpis: OverviewKpis;
  loading: boolean;
}

export function KpiCards({ kpis, loading }: KpiCardsProps) {
  return (
    <div
      data-testid="kpi-cards"
      className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5"
    >
      {/* 1. EUR Expiry Risk */}
      <Card data-testid="kpi-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            EUR Expiry Risk
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <p
              className={`text-2xl font-bold ${kpis.totalExpiryRiskCents > 0 ? 'text-destructive' : ''}`}
            >
              {formatEur(kpis.totalExpiryRiskCents)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2. EUR Stockout Risk */}
      <Card data-testid="kpi-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <PackageX className="h-4 w-4" />
            EUR Stockout Risk
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <p
              className={`text-2xl font-bold ${kpis.totalStockoutRiskCents > 0 ? 'text-destructive' : ''}`}
            >
              {formatEur(kpis.totalStockoutRiskCents)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. Red SKU+WH Pairs */}
      <Card data-testid="kpi-card">
        <CardHeader className="pb-2">
          <div className="text-sm text-muted-foreground">Red SKU+WH Pairs</div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold">
                {kpis.redPercentage.toFixed(1)}%
              </p>
              <Badge variant="destructive">{kpis.redCount}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Batches < 90 Days */}
      <Card data-testid="kpi-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            Batches &lt; 90 Days
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <p className="text-2xl font-bold">{kpis.batchesUnder90Days}</p>
          )}
        </CardContent>
      </Card>

      {/* 5. Inventory Health */}
      <Card data-testid="kpi-card">
        <CardHeader className="pb-2">
          <div className="text-sm text-muted-foreground">Inventory Health</div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <div className="flex items-center gap-3 text-sm font-bold">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                G: {kpis.greenCount}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />
                O: {kpis.orangeCount}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                R: {kpis.redCount}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
