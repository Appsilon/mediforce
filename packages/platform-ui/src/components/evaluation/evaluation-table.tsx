'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';

export const tableWrapperClass = 'overflow-x-auto rounded-md border';
export const tableHeaderRowClass = 'border-b bg-muted text-left text-xs text-muted-foreground';

export interface TableColumn<Row = never> {
  key: string;
  label: React.ReactNode;
  /** Said in a tooltip on the header, reachable by keyboard. */
  help?: string;
  className?: string;
  /** What a row holds in this column; the header then sorts by it. */
  value?: (row: Row) => string | number;
  /** The header also filters to the values the rows hold. Needs `value`. */
  filter?: boolean;
}

type SortDirection = 'asc' | 'desc';

export interface TableView<Row> {
  /** The rows that pass the filters, in the chosen order. */
  rows: Row[];
  sort: { key: string; direction: SortDirection } | null;
  /** Per column, the values unticked; a value the rows gain later shows until it is unticked too. */
  hidden: Readonly<Record<string, ReadonlySet<string>>>;
  /** Every value the rows hold, per filterable column. */
  values: Readonly<Record<string, string[]>>;
  toggleSort: (key: string) => void;
  setHidden: (key: string, value: string, hidden: boolean) => void;
  showAll: (key: string) => void;
  clearFilters: () => void;
}

function compareValues(left: string | number, right: string | number): number {
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

/** Sorts and filters rows by their columns' values; a header click sorts ascending, then descending, then as given. */
export function useTableView<Row>(rows: readonly Row[], columns: readonly TableColumn<Row>[]): TableView<Row> {
  const [sort, setSort] = React.useState<TableView<Row>['sort']>(null);
  const [hidden, setHiddenValues] = React.useState<Record<string, ReadonlySet<string>>>({});

  const values = React.useMemo(() => Object.fromEntries(columns.flatMap((column) => {
    const valueOf = column.value;
    if (column.filter !== true || valueOf === undefined) return [];
    return [[column.key, [...new Set(rows.map((row) => String(valueOf(row))))].sort(compareValues)]];
  })), [rows, columns]);

  const visibleRows = React.useMemo(() => {
    const filtered = rows.filter((row) => columns.every((column) =>
      column.value === undefined || hidden[column.key]?.has(String(column.value(row))) !== true));
    const sortColumn = sort === null ? undefined : columns.find((column) => column.key === sort.key);
    if (sort === null || sortColumn?.value === undefined) return filtered;
    const valueOf = sortColumn.value;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((left, right) => sign * compareValues(valueOf(left), valueOf(right)));
  }, [rows, columns, hidden, sort]);

  return {
    rows: visibleRows,
    sort,
    hidden,
    values,
    toggleSort: (key) => setSort((current) => {
      if (current === null || current.key !== key) return { key, direction: 'asc' };
      return current.direction === 'asc' ? { key, direction: 'desc' } : null;
    }),
    setHidden: (key, value, hide) => setHiddenValues((current) => {
      const next = new Set(current[key]);
      if (hide) next.add(value);
      else next.delete(value);
      return { ...current, [key]: next };
    }),
    showAll: (key) => setHiddenValues((current) => ({ ...current, [key]: new Set() })),
    clearFilters: () => setHiddenValues({}),
  };
}

function ariaSort<Row>(view: TableView<Row> | undefined, key: string): React.AriaAttributes['aria-sort'] {
  if (view?.sort?.key !== key) return undefined;
  return view.sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** The values a column shows, ticked in a popover; untick all but one to see only that one. */
function ColumnFilter<Row>({ column, view }: { column: TableColumn<Row>; view: TableView<Row> }) {
  const all = view.values[column.key] ?? [];
  const isHidden = (value: string) => view.hidden[column.key]?.has(value) === true;
  const active = all.some(isHidden);
  const name = typeof column.label === 'string' ? column.label : column.key;
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Filter ${name}`}
        className={cn('rounded p-0.5 hover:bg-background hover:text-foreground', active && 'text-primary')}
        data-testid={`filter-${column.key}`}
      >
        <Filter className={cn('h-3 w-3', active && 'fill-current')} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 min-w-40 rounded-md border bg-popover p-2 text-xs shadow-md">
          <div className="mb-1.5 font-medium text-muted-foreground">Show {name}</div>
          <ul className="space-y-1">
            {all.map((value) => (
              <li key={value}>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={isHidden(value) === false} onChange={(event) => view.setHidden(column.key, value, event.target.checked === false)} />
                  {value}
                </label>
              </li>
            ))}
          </ul>
          {active && (
            <button type="button" className="mt-2 text-primary hover:underline" onClick={() => view.showAll(column.key)}>Show all</button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A column's label, sorting the table when its column has values. */
function ColumnLabel<Row>({ column, view }: { column: TableColumn<Row>; view: TableView<Row> | undefined }) {
  if (view === undefined || column.value === undefined) return <>{column.label}</>;
  const direction = view.sort?.key === column.key ? view.sort.direction : null;
  const SortIcon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => view.toggleSort(column.key)} data-testid={`sort-${column.key}`}>
      {column.label}
      <SortIcon className={cn('h-3 w-3', direction === null && 'opacity-40')} />
    </button>
  );
}

/** A table's header row from its columns; a row's full-width details span `columns.length`. With a `view`, columns with values sort and filter. */
export function TableHead<Row>({ columns, view }: { columns: readonly TableColumn<Row>[]; view?: TableView<Row> }) {
  return (
    <thead>
      <tr className={tableHeaderRowClass}>
        {columns.map((column) => (
          <th key={column.key} className={cn('px-3 py-2 font-medium', column.className)} aria-sort={ariaSort(view, column.key)}>
            <span className="inline-flex items-center gap-0.5">
              {column.help === undefined ? <ColumnLabel column={column} view={view} /> : (
                <InstantTooltip label={column.help}>
                  <span className="inline-flex" tabIndex={view === undefined || column.value === undefined ? 0 : undefined}>
                    <ColumnLabel column={column} view={view} />
                  </span>
                </InstantTooltip>
              )}
              {view !== undefined && column.filter === true && <ColumnFilter column={column} view={view} />}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** In place of a table's rows when the filters leave none. */
export function NoMatchingRows({ columns, onClear }: { columns: number; onClear: () => void }) {
  return (
    <tbody>
      <tr>
        <td colSpan={columns} className="px-3 py-3 text-xs text-muted-foreground" data-testid="no-matching-rows">
          Nothing matches the filters.{' '}
          <button type="button" className="text-primary hover:underline" onClick={onClear}>Clear filters</button>
        </td>
      </tr>
    </tbody>
  );
}

/** A full-width row under a table row: its details, or a form editing it. */
export function DetailsRow({ columns, className, children, testId }: {
  columns: number;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <tr>
      <td colSpan={columns} className={cn('bg-muted/20 px-3 pb-3 pt-1', className)} data-testid={testId}>{children}</td>
    </tr>
  );
}

/** A link-styled button that opens and closes what it names, its chevron turning with it. */
export function DisclosureButton({ open, onToggle, children, ...rest }: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { 'data-testid'?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
      onClick={onToggle}
      {...rest}
    >
      {children}
      <ChevronRight className={cn('h-3 w-3 transition-transform', open === true && 'rotate-90')} />
    </button>
  );
}
