'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown, X } from 'lucide-react';
import type { RiskLevel } from '@mediforce/supply-intelligence';

interface FilterState {
  riskLevel: RiskLevel[] | null;
  warehouse: string[] | null;
  country: string[] | null;
}

interface TableToolbarProps {
  filters: FilterState;
  onFilterChange: (updates: Partial<FilterState>) => void;
  warehouses: string[];
  countries: string[];
}

export function TableToolbar({
  filters,
  onFilterChange,
  warehouses,
  countries,
}: TableToolbarProps) {
  const activeFilterCount =
    (filters.riskLevel?.length ?? 0) +
    (filters.warehouse?.length ?? 0) +
    (filters.country?.length ?? 0);

  function toggleRiskLevel(level: RiskLevel) {
    const current = filters.riskLevel ?? [];
    const isActive = current.includes(level);
    const next = isActive
      ? current.filter((l) => l !== level)
      : [...current, level];
    onFilterChange({ riskLevel: next.length > 0 ? next : null });
  }

  function toggleWarehouse(name: string) {
    const current = filters.warehouse ?? [];
    const isActive = current.includes(name);
    const next = isActive
      ? current.filter((w) => w !== name)
      : [...current, name];
    onFilterChange({ warehouse: next.length > 0 ? next : null });
  }

  function toggleCountry(code: string) {
    const current = filters.country ?? [];
    const isActive = current.includes(code);
    const next = isActive
      ? current.filter((c) => c !== code)
      : [...current, code];
    onFilterChange({ country: next.length > 0 ? next : null });
  }

  function clearAllFilters() {
    onFilterChange({ riskLevel: null, warehouse: null, country: null });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Warehouse filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            Warehouse
            {filters.warehouse && filters.warehouse.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                {filters.warehouse.length}
              </Badge>
            )}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {warehouses.map((wh) => {
              const isChecked = filters.warehouse?.includes(wh) ?? false;
              return (
                <label
                  key={wh}
                  className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleWarehouse(wh)}
                  />
                  {wh}
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Country filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            Country
            {filters.country && filters.country.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                {filters.country.length}
              </Badge>
            )}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {countries.map((code) => {
              const isChecked = filters.country?.includes(code) ?? false;
              return (
                <label
                  key={code}
                  className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleCountry(code)}
                  />
                  {code}
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Risk level filter */}
      <div className="flex items-center gap-1">
        <button
          data-testid="risk-filter-red"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer border ${
            filters.riskLevel?.includes('red')
              ? 'bg-destructive text-destructive-foreground border-transparent'
              : 'bg-transparent text-muted-foreground border-input hover:bg-secondary'
          }`}
          onClick={() => toggleRiskLevel('red')}
        >
          Red
        </button>
        <button
          data-testid="risk-filter-orange"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer border ${
            filters.riskLevel?.includes('orange')
              ? 'bg-orange-500 text-white border-transparent'
              : 'bg-transparent text-muted-foreground border-input hover:bg-secondary'
          }`}
          onClick={() => toggleRiskLevel('orange')}
        >
          Orange
        </button>
        <button
          data-testid="risk-filter-green"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer border ${
            filters.riskLevel?.includes('green')
              ? 'bg-green-600 text-white border-transparent'
              : 'bg-transparent text-muted-foreground border-input hover:bg-secondary'
          }`}
          onClick={() => toggleRiskLevel('green')}
        >
          Green
        </button>
      </div>

      {/* Active filter count + clear */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={clearAllFilters}
        >
          Clear filters
          <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
            {activeFilterCount}
          </Badge>
          <X className="ml-1 h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
