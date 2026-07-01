'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared input style tokens — import these instead of defining locally
// ---------------------------------------------------------------------------

export const inputBase = 'w-full bg-muted/60 text-sm rounded-xl border-0 focus:ring-2 focus:ring-primary/30 focus:outline-none px-3 py-2 transition-colors';
export const inputBaseMono = `${inputBase} font-mono`;
export const selectBase = `${inputBase} cursor-pointer appearance-none pr-9 bg-no-repeat bg-[length:1rem] bg-[right_0.65rem_center] bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23737373%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')]`;
export const textareaBase = `${inputBase} resize-y leading-relaxed`;

// ---------------------------------------------------------------------------
// humanizeToken — turns a raw dev-facing key or enum value (dot-path,
// camelCase, kebab-case, snake_case) into a proper-cased display label with
// no separators. Only affects what's rendered; the underlying value/prop the
// caller passes elsewhere (e.g. an <option value=...>) is untouched.
// ---------------------------------------------------------------------------

const HUMANIZE_ACRONYMS = new Set(['http', 'https', 'mcp', 'url', 'id', 'llm', 'json', 'yaml', 'api', 'sdk']);

export function humanizeToken(raw: string): string {
  return raw
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((word) => (
      HUMANIZE_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ))
    .join(' ');
}

// ---------------------------------------------------------------------------

function FieldTooltip({ text }: { text: string }) {
  return (
    <div className="relative group/tip inline-flex items-center shrink-0" data-testid="field-tooltip-trigger">
      <Info className="h-3.5 w-3.5 text-muted-foreground/40 group-hover/tip:text-primary/60 cursor-help transition-colors" />
      <div className="absolute left-5 top-1/2 -translate-y-1/2 z-[9999] hidden group-hover/tip:block w-56 rounded-lg bg-popover border border-border shadow-md px-2.5 py-2 text-xs text-popover-foreground leading-relaxed pointer-events-none">
        {text}
      </div>
    </div>
  );
}

export function FieldRow({
  label,
  children,
  error,
  alignStart,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  alignStart?: boolean;
  tooltip?: string;
}) {
  const displayLabel = humanizeToken(label);
  return (
    <div className={cn('flex flex-col gap-1.5', alignStart && 'items-start')}>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-xs font-medium text-muted-foreground truncate" title={displayLabel}>{displayLabel}</span>
        {tooltip && <FieldTooltip text={tooltip} />}
      </div>
      <div className="min-w-0 w-full">{children}</div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-0.5">{title}</p>
      {children}
    </div>
  );
}

export function PillToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ElementType; activeClassName?: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
              active
                ? (opt.activeClassName ?? 'border-primary bg-primary/10 text-primary')
                : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function EditableField({ label, value, onChange, mono, placeholder, suffix }: {
  label: string; value: string; onChange: (v: string) => void;
  mono?: boolean; placeholder?: string; suffix?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-baseline gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-28',
            mono && 'font-mono',
            !value && 'placeholder:text-muted-foreground/40 placeholder:italic',
          )}
        />
        {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
