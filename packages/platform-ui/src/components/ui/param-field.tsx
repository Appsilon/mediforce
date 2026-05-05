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
    'w-full rounded-md border bg-background px-3 py-2 text-sm',
    'placeholder:text-muted-foreground',
    'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
    disabled && 'opacity-50 cursor-not-allowed',
  );

export function ParamField({ param, value, onChange, disabled }: ParamFieldProps) {
  const type = param.type ?? 'string';

  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline gap-1.5 text-sm font-medium">
        {param.name}
        {param.required && <span className="text-destructive">*</span>}
      </label>
      {param.description && (
        <p className="text-xs text-muted-foreground">{param.description}</p>
      )}
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
                const next = event.target.checked
                  ? [...selected, opt]
                  : selected.filter((item) => item !== opt);
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
          <option key={opt} value={opt}>{opt}</option>
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
