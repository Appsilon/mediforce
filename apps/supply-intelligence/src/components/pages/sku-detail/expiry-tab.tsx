'use client';

import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import type { Batch, ExpiryRiskResult } from '@mediforce/supply-intelligence';
import { formatEur } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

interface ExpiryDisplayRow {
  lotNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  onHand: number;
  remainingAtExpiry: number;
  expiryRiskCents: number;
}

interface ExpiryTabProps {
  batches: Batch[];
  expiryResults: ExpiryRiskResult[];
  loading: boolean;
}

export function ExpiryTab({ batches, expiryResults, loading }: ExpiryTabProps) {
  const rows = useMemo(() => {
    const resultMap = new Map<string, ExpiryRiskResult>();
    for (const r of expiryResults) {
      resultMap.set(r.batchId, r);
    }

    const today = new Date();
    const displayRows: ExpiryDisplayRow[] = batches.map((batch) => {
      const result = resultMap.get(batch.id);
      const expiryDate = new Date(batch.expiryDate);
      const daysToExpiry = differenceInDays(expiryDate, today);

      return {
        lotNumber: batch.lotNumber,
        expiryDate: batch.expiryDate,
        daysToExpiry,
        onHand: batch.quantityOnHand,
        remainingAtExpiry: result?.remainingAtExpiry ?? 0,
        expiryRiskCents: result?.expiryRiskCents ?? 0,
      };
    });

    // Sort by expiry date ascending (FEFO order)
    displayRows.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

    return displayRows;
  }, [batches, expiryResults]);

  if (loading) {
    return (
      <div data-testid="expiry-tab" className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const totalOnHand = rows.reduce((sum, r) => sum + r.onHand, 0);
  const totalRemaining = rows.reduce((sum, r) => sum + r.remainingAtExpiry, 0);
  const totalRiskCents = rows.reduce((sum, r) => sum + r.expiryRiskCents, 0);

  return (
    <div data-testid="expiry-tab">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch ID</TableHead>
            <TableHead>Sell-By Date</TableHead>
            <TableHead className="text-right">Days to Sell-By</TableHead>
            <TableHead className="text-right">On Hand</TableHead>
            <TableHead className="text-right">Remaining at Sell-By</TableHead>
            <TableHead className="text-right">EUR Expiry Risk</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.lotNumber}
              className={cn(
                'hover:bg-muted/50',
                row.daysToExpiry <= 0 && 'bg-red-50 dark:bg-red-950/30',
                row.daysToExpiry > 0 && row.daysToExpiry < 90 && 'bg-orange-50 dark:bg-orange-950/30',
              )}
            >
              <TableCell className="font-mono text-sm">{row.lotNumber}</TableCell>
              <TableCell>{formatDate(row.expiryDate)}</TableCell>
              <TableCell className={cn('text-right', row.daysToExpiry <= 0 && 'text-destructive font-medium')}>
                {row.daysToExpiry}
              </TableCell>
              <TableCell className="text-right">{row.onHand.toLocaleString()}</TableCell>
              <TableCell className="text-right">{row.remainingAtExpiry.toLocaleString()}</TableCell>
              <TableCell className="text-right">{formatEur(row.expiryRiskCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="font-semibold">Total</TableCell>
            <TableCell className="text-right font-semibold">{totalOnHand.toLocaleString()}</TableCell>
            <TableCell className="text-right font-semibold">{totalRemaining.toLocaleString()}</TableCell>
            <TableCell className="text-right font-semibold">{formatEur(totalRiskCents)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
