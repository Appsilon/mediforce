"use client";

import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

type SortDirection = 'asc' | 'desc' | null;

export function SortableColumnHeader({
  label,
  sortDirection,
  onSort,
}: {
  label: string;
  sortDirection: SortDirection;
  onSort: () => void;
}) {
  return (
    <button
      className="flex items-center gap-1 hover:text-primary transition-colors group"
      onClick={onSort}
    >
      <span>{label}</span>
      {sortDirection === 'asc' ? (
        <ArrowUp className="h-3 w-3 text-primary" />
      ) : sortDirection === 'desc' ? (
        <ArrowDown className="h-3 w-3 text-primary" />
      ) : (
        <ArrowUpDown className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}
