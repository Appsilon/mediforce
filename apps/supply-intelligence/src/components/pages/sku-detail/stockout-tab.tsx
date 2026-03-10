'use client';

import type { StockoutRiskResult } from '@mediforce/supply-intelligence';
import { formatEur } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface StockoutTabProps {
  stockoutResult: StockoutRiskResult;
  loading: boolean;
}

export function StockoutTab({ stockoutResult, loading }: StockoutTabProps) {
  if (loading) {
    return (
      <div data-testid="stockout-tab" className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const { projections, shortfallUnits, stockoutRiskCents, firstStockoutWeek } = stockoutResult;

  return (
    <div data-testid="stockout-tab" className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Week</TableHead>
            <TableHead className="text-right">Starting Inventory</TableHead>
            <TableHead className="text-right">Demand</TableHead>
            <TableHead className="text-right">Inbound</TableHead>
            <TableHead className="text-right">Ending Inventory</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projections.map((proj) => (
            <TableRow
              key={proj.week}
              className={cn(
                'hover:bg-muted/50',
                proj.endingInventory < 0 && 'bg-red-50 dark:bg-red-950/30 text-destructive font-medium',
              )}
            >
              <TableCell>
                <div>
                  <span className="font-medium">Week {proj.week}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {formatWeekDate(proj.weekStartDate)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">{proj.startingInventory.toLocaleString()}</TableCell>
              <TableCell className="text-right">{proj.demand.toLocaleString()}</TableCell>
              <TableCell className="text-right">{proj.inbound.toLocaleString()}</TableCell>
              <TableCell className={cn('text-right', proj.endingInventory < 0 && 'font-bold')}>
                {proj.endingInventory.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Summary card */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SummaryItem
              label="Total Shortfall"
              value={`${shortfallUnits.toLocaleString()} units`}
              highlight={shortfallUnits > 0}
            />
            <SummaryItem
              label="Stockout Risk"
              value={formatEur(stockoutRiskCents)}
              highlight={stockoutRiskCents > 0}
            />
            <SummaryItem
              label="First Stockout"
              value={firstStockoutWeek != null ? `Week ${firstStockoutWeek}` : 'No stockout projected'}
              highlight={firstStockoutWeek != null}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold', highlight && 'text-destructive')}>
        {value}
      </p>
    </div>
  );
}

function formatWeekDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}
