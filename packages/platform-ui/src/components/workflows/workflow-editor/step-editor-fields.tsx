'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

function FieldTooltip({ text }: { text: string }) {
  return (
    <div className="relative group/tip inline-flex items-center shrink-0">
      <Info className="h-3 w-3 text-muted-foreground/30 group-hover/tip:text-primary/50 cursor-help transition-colors" />
      <div className="absolute left-5 top-1/2 -translate-y-1/2 z-50 hidden group-hover/tip:block w-56 rounded-md bg-popover border border-border shadow-md px-2.5 py-2 text-[10px] text-popover-foreground leading-relaxed pointer-events-none">
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
  return (
    <div className="border-b border-border/30 last:border-0">
      <div className={cn('grid grid-cols-[184px_1fr] gap-x-3 px-3 py-1', alignStart ? 'items-start' : 'items-center')}>
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-[11px] text-muted-foreground/60 select-none leading-5 truncate">{label}</span>
          {tooltip && <FieldTooltip text={tooltip} />}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
      {error && <p className="text-[10px] text-red-500 pb-1 pl-[208px]">{error}</p>}
    </div>
  );
}

export function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border/50">{children}</div>;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-0.5">{title}</p>
      {children}
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
