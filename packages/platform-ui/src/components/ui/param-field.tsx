'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ParamFieldDef {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  options?: string[];
}

interface ParamFieldProps {
  param: ParamFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

const inputClasses = (disabled?: boolean) =>
  cn(
    'w-full rounded-md border bg-white dark:bg-white/[0.05] px-3 py-2 text-sm',
    'placeholder:text-muted-foreground',
    'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
    disabled && 'opacity-50 cursor-not-allowed',
  );

// Convert a stored datetime string to YYYY-MM-DDTHH:MM in the browser's local
// timezone, suitable for a datetime-local input's value prop.
// UTC ISO strings ("2026-06-18T09:15:00.000Z") round-trip correctly.
// Legacy no-timezone strings ("2026-06-18T11:15:00") display the wall-clock
// time the user originally typed, but the value stored in the DB was already
// misinterpreted as UTC by the server — the display looks consistent, but the
// downstream scheduled time was wrong. Only newly-entered values are correct.
function toLocalDatetimeInput(stored: string): string {
  if (!stored) return '';
  const date = new Date(stored);
  if (isNaN(date.getTime())) return stored.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// Build a short timezone label like "Europe/Warsaw (UTC+2)" for display.
function buildTzLabel(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMin = new Date().getTimezoneOffset(); // negative east of UTC
  const absMins = Math.abs(offsetMin);
  const sign = offsetMin <= 0 ? '+' : '-';
  const h = Math.floor(absMins / 60);
  const m = absMins % 60;
  const offset = m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
  return `${tz} (${offset})`;
}

// Separate component so tzLabel is set client-side only (useEffect), preventing
// a flash if this component is ever moved into an SSR context.
function DatetimeField({
  value,
  onChange,
  disabled,
  classes,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  classes: string;
}) {
  const [tzLabel, setTzLabel] = React.useState<string | null>(null);
  React.useEffect(() => {
    setTzLabel(buildTzLabel());
  }, []);

  return (
    <div className="space-y-1">
      <input
        type="datetime-local"
        value={toLocalDatetimeInput(String(value ?? ''))}
        onChange={(event) => {
          const s = event.target.value;
          if (!s) {
            onChange('');
            return;
          }
          // Browser parses datetime-local strings as local time; .toISOString()
          // converts to UTC so the server always receives an unambiguous timestamp.
          const date = new Date(s);
          onChange(isNaN(date.getTime()) ? s : date.toISOString());
        }}
        disabled={disabled}
        className={classes}
      />
      {tzLabel !== null && <p className="text-xs text-muted-foreground">{tzLabel}</p>}
    </div>
  );
}

export function ParamField({ param, value, onChange, disabled }: ParamFieldProps) {
  const type = param.type ?? 'string';

  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline gap-1.5 text-sm font-medium">
        {param.name}
        {param.required && <span className="text-destructive">*</span>}
      </label>
      {param.description && <p className="text-xs text-muted-foreground">{param.description}</p>}
      {renderInput(type, param, value, onChange, disabled)}
    </div>
  );
}

function renderInput(
  type: string,
  param: ParamFieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
) {
  const classes = inputClasses(disabled);

  if (type === 'multiselect' && param.options && param.options.length > 0) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-1">
        {param.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={(event) => {
                const next = event.target.checked ? [...selected, opt] : selected.filter((item) => item !== opt);
                onChange(next);
              }}
              disabled={disabled}
              className="h-4 w-4 rounded border"
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (param.options && param.options.length > 0) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={classes}
      >
        <option value="">Select...</option>
        {param.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border"
        />
        {param.description ?? param.name}
      </label>
    );
  }

  if (type === 'number') {
    return (
      <input
        type="number"
        value={value === undefined ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={param.default !== undefined ? String(param.default) : undefined}
        className={classes}
      />
    );
  }

  if (type === 'date') {
    return (
      <input
        type="date"
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={classes}
      />
    );
  }

  if (type === 'datetime') {
    return <DatetimeField value={value} onChange={onChange} disabled={disabled} classes={classes} />;
  }

  if (type === 'textarea') {
    return (
      <textarea
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={param.default !== undefined ? String(param.default) : undefined}
        rows={4}
        className={cn(classes, 'resize-y min-h-[96px]')}
      />
    );
  }

  // Default: single-line string
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      placeholder={param.default !== undefined ? String(param.default) : undefined}
      className={classes}
    />
  );
}
