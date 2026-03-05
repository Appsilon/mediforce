'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { RiskRow } from '@/lib/risk-aggregations';
import { RiskBadge } from './risk-badge';
import { SortableColumnHeader } from '@/components/ui/sortable-column-header';
import { formatEur } from '@/lib/utils';

type SortDirection = 'asc' | 'desc' | null;

interface ColumnOptions {
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (column: string) => void;
}

function getSortDirection(
  columnId: string,
  options: ColumnOptions,
): SortDirection {
  return options.sortBy === columnId ? options.sortDir : null;
}

export function getColumns(options: ColumnOptions): ColumnDef<RiskRow>[] {
  return [
    {
      accessorKey: 'skuName',
      header: () => (
        <SortableColumnHeader
          label="SKU"
          sortDirection={getSortDirection('skuName', options)}
          onSort={() => options.onSort('skuName')}
        />
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.getValue('skuName')}</span>
      ),
    },
    {
      accessorKey: 'warehouseName',
      header: () => (
        <SortableColumnHeader
          label="Warehouse"
          sortDirection={getSortDirection('warehouseName', options)}
          onSort={() => options.onSort('warehouseName')}
        />
      ),
    },
    {
      accessorKey: 'country',
      header: 'Country',
    },
    {
      accessorKey: 'riskLevel',
      header: () => (
        <SortableColumnHeader
          label="Risk"
          sortDirection={getSortDirection('riskLevel', options)}
          onSort={() => options.onSort('riskLevel')}
        />
      ),
      cell: ({ row }) => <RiskBadge level={row.getValue('riskLevel')} />,
    },
    {
      accessorKey: 'onHand',
      header: () => (
        <SortableColumnHeader
          label="On Hand"
          sortDirection={getSortDirection('onHand', options)}
          onSort={() => options.onSort('onHand')}
        />
      ),
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {(row.getValue('onHand') as number).toLocaleString()}
        </span>
      ),
    },
    {
      accessorKey: 'monthlyDemand',
      header: () => (
        <SortableColumnHeader
          label="Monthly Demand"
          sortDirection={getSortDirection('monthlyDemand', options)}
          onSort={() => options.onSort('monthlyDemand')}
        />
      ),
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {(row.getValue('monthlyDemand') as number).toLocaleString()}
        </span>
      ),
    },
    {
      accessorKey: 'coverageWeeks',
      header: () => (
        <SortableColumnHeader
          label="Coverage"
          sortDirection={getSortDirection('coverageWeeks', options)}
          onSort={() => options.onSort('coverageWeeks')}
        />
      ),
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {row.getValue('coverageWeeks') as number}w
        </span>
      ),
    },
    {
      accessorKey: 'expiryRiskCents',
      header: () => (
        <SortableColumnHeader
          label="EUR Expiry Risk"
          sortDirection={getSortDirection('expiryRiskCents', options)}
          onSort={() => options.onSort('expiryRiskCents')}
        />
      ),
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {formatEur(row.getValue('expiryRiskCents') as number)}
        </span>
      ),
    },
    {
      accessorKey: 'stockoutRiskCents',
      header: () => (
        <SortableColumnHeader
          label="EUR Stockout Risk"
          sortDirection={getSortDirection('stockoutRiskCents', options)}
          onSort={() => options.onSort('stockoutRiskCents')}
        />
      ),
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {formatEur(row.getValue('stockoutRiskCents') as number)}
        </span>
      ),
    },
    {
      id: 'issueStatus',
      header: '',
      cell: () => null,
    },
  ];
}
