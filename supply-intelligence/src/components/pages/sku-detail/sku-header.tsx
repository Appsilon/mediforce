'use client';

import type { RiskRow } from '@/lib/risk-aggregations';
import { formatEur } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles } from 'lucide-react';

/** Country code to flag emoji — maps 2-letter ISO to Unicode regional indicators */
function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return code;
  const codePoints = [...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

const RISK_BADGE_MAP: Record<string, { label: string; className: string }> = {
  red: {
    label: 'Critical',
    className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  },
  orange: {
    label: 'Warning',
    className: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  },
  green: {
    label: 'Healthy',
    className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
  },
};

interface SkuHeaderProps {
  riskRow: RiskRow;
  skuName: string;
  warehouseName: string;
  loading: boolean;
  aiSummary?: { narrative: string; generatedAt: string } | null;
}

export function SkuHeader({ riskRow, skuName, warehouseName, loading, aiSummary }: SkuHeaderProps) {
  if (loading) {
    return (
      <Card data-testid="sku-header">
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const badge = RISK_BADGE_MAP[riskRow.riskLevel] ?? RISK_BADGE_MAP.green;

  return (
    <Card data-testid="sku-header">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle className="text-2xl font-headline">{skuName}</CardTitle>
          <Badge className={badge.className}>{badge.label}</Badge>
        </div>
        <CardDescription>
          {warehouseName} {countryFlag(riskRow.country)} {riskRow.country}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCell label="On Hand" value={`${riskRow.onHand.toLocaleString()} units`} />
          <MetricCell label="Monthly Demand" value={`${riskRow.monthlyDemand.toLocaleString()} units`} />
          <MetricCell label="Coverage" value={`${riskRow.coverageWeeks} weeks`} />
          <MetricCell label="EUR Expiry Risk" value={formatEur(riskRow.expiryRiskCents)} />
          <MetricCell label="EUR Stockout Risk" value={formatEur(riskRow.stockoutRiskCents)} />
          <MetricCell label="Nearest Expiry" value={`${riskRow.nearestExpiryDays} days`} />
        </div>

        {/* AI Driver Summary */}
        <div data-testid="sku-ai-summary">
          {aiSummary ? (
            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm leading-relaxed">{aiSummary.narrative}</p>
                  <p className="text-xs text-muted-foreground">
                    Generated{' '}
                    {formatDistanceToNow(new Date(aiSummary.generatedAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-dashed p-4 text-muted-foreground">
              <Sparkles className="h-5 w-5 mt-0.5 shrink-0" />
              <p className="text-sm italic">
                No AI summary available. Run analysis from the Overview page.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
