"use client";

import * as React from 'react';
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Filter, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

type SortDirection = 'asc' | 'desc' | null;

export function ColumnFilterPopover({
  label,
  options,
  selected,
  onChange,
  sortDirection,
  onSort,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  sortDirection?: SortDirection;
  onSort?: () => void;
}) {
  const hasFilter = selected.size > 0;
  const hasSortActive = sortDirection != null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 hover:text-primary transition-colors group">
          <span>{label}</span>
          {hasSortActive ? (
            sortDirection === 'asc' ? (
              <ArrowUp className="h-3 w-3 text-primary" />
            ) : (
              <ArrowDown className="h-3 w-3 text-primary" />
            )
          ) : null}
          <Filter className={`h-3 w-3 transition-colors ${hasFilter ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        {onSort && (
          <div className="mb-2 pb-2 border-b">
            <span className="text-xs font-medium text-muted-foreground uppercase px-1">Sort</span>
            <button
              className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary w-full text-sm mt-1"
              onClick={onSort}
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortDirection === 'asc' ? 'Ascending'
                : sortDirection === 'desc' ? 'Descending'
                : 'Not sorted'}
            </button>
          </div>
        )}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-muted-foreground uppercase">Filter {label}</span>
          {hasFilter && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => onChange(new Set())}
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-1">
          {options.map((opt) => {
            const isChecked = selected.size === 0 || selected.has(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary cursor-pointer text-sm"
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected.size === 0 ? options : selected);
                    if (checked) {
                      next.add(opt);
                    } else {
                      next.delete(opt);
                    }
                    // If all selected, clear filter
                    onChange(next.size === options.length ? new Set() : next);
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
