'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryStates } from 'nuqs';
import { useSupplyData } from '@/hooks/use-supply-data';
import { operationalParsers } from '@/lib/url-state';
import { getColumns } from '@/components/pages/operational/columns';
import { DataTable } from '@/components/pages/operational/data-table';
import { TableToolbar } from '@/components/pages/operational/table-toolbar';
import type { RiskRow } from '@/lib/risk-aggregations';
import type { RiskLevel } from '@mediforce/supply-intelligence';

const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  red: 0,
  orange: 1,
  green: 2,
};

export default function OperationalPage() {
  const { riskRows, loading } = useSupplyData();
  const router = useRouter();
  const [filters, setFilters] = useQueryStates(operationalParsers);

  // Derive unique filter options from data
  const uniqueWarehouses = useMemo(() => {
    const set = new Set(riskRows.map((r) => r.warehouseName));
    return Array.from(set).sort();
  }, [riskRows]);

  const uniqueCountries = useMemo(() => {
    const set = new Set(riskRows.map((r) => r.country));
    return Array.from(set).sort();
  }, [riskRows]);

  // Apply filters
  const filteredRows = useMemo(() => {
    let rows = riskRows;

    if (filters.riskLevel && filters.riskLevel.length > 0) {
      const levels = new Set(filters.riskLevel);
      rows = rows.filter((r) => levels.has(r.riskLevel));
    }

    if (filters.warehouse && filters.warehouse.length > 0) {
      const names = new Set(filters.warehouse);
      rows = rows.filter((r) => names.has(r.warehouseName));
    }

    if (filters.country && filters.country.length > 0) {
      const codes = new Set(filters.country);
      rows = rows.filter((r) => codes.has(r.country));
    }

    return rows;
  }, [riskRows, filters.riskLevel, filters.warehouse, filters.country]);

  // Apply sorting
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    const { sortBy, sortDir } = filters;
    const direction = sortDir === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      if (sortBy === 'riskLevel') {
        return (RISK_LEVEL_ORDER[a.riskLevel] - RISK_LEVEL_ORDER[b.riskLevel]) * direction;
      }

      const aVal = a[sortBy as keyof RiskRow];
      const bVal = b[sortBy as keyof RiskRow];

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * direction;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * direction;
      }

      return 0;
    });

    return sorted;
  }, [filteredRows, filters.sortBy, filters.sortDir]);

  // Apply pagination
  const pageSize = filters.pageSize;
  const pageIndex = filters.page - 1; // nuqs is 1-indexed, TanStack is 0-indexed
  const pageCount = Math.ceil(sortedRows.length / pageSize);
  const paginatedRows = useMemo(() => {
    return sortedRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }, [sortedRows, pageIndex, pageSize]);

  // Row click handler: navigate to SKU Detail
  function handleRowClick(row: RiskRow) {
    router.push(`/sku/${row.skuId}?warehouse=${row.warehouseId}`);
  }

  // Sort handler: toggle direction or switch column
  function handleSort(column: string) {
    if (filters.sortBy === column) {
      setFilters({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilters({ sortBy: column as typeof filters.sortBy, sortDir: 'desc', page: 1 });
    }
  }

  const columns = getColumns({
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    onSort: handleSort,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold font-headline">Operational View</h1>
      <TableToolbar
        filters={filters}
        onFilterChange={(updates) => setFilters({ ...updates, page: 1 })}
        warehouses={uniqueWarehouses}
        countries={uniqueCountries}
      />
      <DataTable
        columns={columns}
        data={paginatedRows}
        pageCount={pageCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={(p) => setFilters({ page: p + 1 })}
        onPageSizeChange={(size) => setFilters({ pageSize: size, page: 1 })}
        onRowClick={handleRowClick}
        loading={loading}
        totalRows={sortedRows.length}
      />
    </div>
  );
}
