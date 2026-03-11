'use client';

import { useState, useMemo } from 'react';
import { Download, AlertOctagon, AlertTriangle, Info, Filter } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { validationIssues, studyFiles, getTotalIssueCounts } from '@/lib/demo-data';
import type { ValidationIssue, ValidationSeverity } from '@/lib/types';

const issueCounts = getTotalIssueCounts();

function SeverityBadge({ severity }: { severity: ValidationSeverity }) {
  if (severity === 'Error') {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <AlertOctagon className="h-3 w-3" />
        Error
      </Badge>
    );
  }
  if (severity === 'Warning') {
    return (
      <Badge variant="warning" className="gap-1 text-xs">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    );
  }
  return (
    <Badge variant="info" className="gap-1 text-xs">
      <Info className="h-3 w-3" />
      Info
    </Badge>
  );
}

const columnHelper = createColumnHelper<ValidationIssue>();

const columns = [
  columnHelper.accessor('severity', {
    header: 'Severity',
    cell: (info) => <SeverityBadge severity={info.getValue()} />,
    filterFn: (row, _columnId, filterValue: string) => {
      if (filterValue === 'all') return true;
      return row.original.severity === filterValue;
    },
  }),
  columnHelper.accessor('fileName', {
    header: 'File',
    cell: (info) => (
      <span className="text-sm font-medium text-primary">{info.getValue()}</span>
    ),
    filterFn: (row, _columnId, filterValue: string) => {
      if (filterValue === 'all') return true;
      return row.original.fileId === filterValue;
    },
  }),
  columnHelper.accessor('domain', {
    header: 'Domain',
    cell: (info) => (
      <Badge variant="outline" className="text-xs">
        {info.getValue()}
      </Badge>
    ),
  }),
  columnHelper.accessor('variable', {
    header: 'Variable',
    cell: (info) => (
      <code className="font-mono text-xs font-medium bg-muted px-1.5 py-0.5 rounded">
        {info.getValue()}
      </code>
    ),
  }),
  columnHelper.accessor('row', {
    header: 'Row',
    cell: (info) => (
      <span className="text-sm text-muted-foreground text-center block">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('description', {
    header: 'Description',
    cell: (info) => <span className="text-sm">{info.getValue()}</span>,
  }),
  columnHelper.accessor('cellValue', {
    header: 'Value',
    cell: (info) => {
      const value = info.getValue();
      if (value === undefined || value === '') {
        return <span className="text-xs text-muted-foreground italic">empty</span>;
      }
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{value}</code>
      );
    },
  }),
];

function exportToCsv(issues: ValidationIssue[]) {
  const headers = ['Severity', 'File', 'Domain', 'Variable', 'Row', 'Description', 'Value'];
  const csvRows = [
    headers.join(','),
    ...issues.map((issue) =>
      [
        issue.severity,
        `"${issue.fileName}"`,
        issue.domain,
        issue.variable,
        issue.row,
        `"${issue.description.replace(/"/g, '""')}"`,
        `"${(issue.cellValue ?? '').replace(/"/g, '""')}"`,
      ].join(',')
    ),
  ];
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'validation_issues.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function ValidationIssuesPage() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [fileFilter, setFileFilter] = useState<string>('all');

  const filesWithIssues = useMemo(
    () => studyFiles.filter((f) => f.hasIssues),
    []
  );

  const filteredIssues = useMemo(() => {
    return validationIssues.filter((issue) => {
      const matchesSeverity = severityFilter === 'all' || issue.severity === severityFilter;
      const matchesFile = fileFilter === 'all' || issue.fileId === fileFilter;
      return matchesSeverity && matchesFile;
    });
  }, [severityFilter, fileFilter]);

  const table = useReactTable({
    data: filteredIssues,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-bold font-headline">{issueCounts.total}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Issues</div>
        </div>
        <div className="rounded-lg border bg-card p-4 border-l-4 border-l-destructive">
          <div className="text-2xl font-bold font-headline text-destructive">
            {issueCounts.errors}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Errors</div>
        </div>
        <div className="rounded-lg border bg-card p-4 border-l-4 border-l-yellow-500">
          <div className="text-2xl font-bold font-headline text-yellow-600">
            {issueCounts.warnings}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Warnings</div>
        </div>
        <div className="rounded-lg border bg-card p-4 border-l-4 border-l-blue-500">
          <div className="text-2xl font-bold font-headline text-blue-600">
            {issueCounts.info}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Info</div>
        </div>
      </div>

      {/* Filters and export */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="Error">Error</SelectItem>
            <SelectItem value="Warning">Warning</SelectItem>
            <SelectItem value="Info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fileFilter} onValueChange={setFileFilter}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="File" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All files</SelectItem>
            {filesWithIssues.map((file) => (
              <SelectItem key={file.id} value={file.id}>
                {file.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => exportToCsv(filteredIssues)}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                  No validation issues match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filteredIssues.length} of {validationIssues.length} issues
      </p>
    </div>
  );
}
