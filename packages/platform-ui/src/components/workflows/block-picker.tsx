'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User, Bot, Terminal, Zap, PenLine, GitBranch, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NewStepPayload } from '@/lib/control-mode';
import { CM_ROWS, STEP_TYPE_OPTIONS, type CMRow } from '@/lib/block-presets';

// Full Tailwind class strings — must not be constructed dynamically (purge safety).
const BUTTON_CLASSES: Record<string, string> = {
  orange: 'hover:bg-orange-50 hover:text-orange-700 hover:border-orange-400 hover:ring-1 hover:ring-orange-200 dark:hover:bg-orange-950/20 dark:hover:text-orange-300 dark:hover:border-orange-500 dark:hover:ring-orange-800',
  yellow: 'hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-400 hover:ring-1 hover:ring-yellow-200 dark:hover:bg-yellow-950/20 dark:hover:text-yellow-300 dark:hover:border-yellow-500 dark:hover:ring-yellow-800',
  pink:   'hover:bg-pink-50 hover:text-pink-700 hover:border-pink-400 hover:ring-1 hover:ring-pink-200 dark:hover:bg-pink-950/20 dark:hover:text-pink-300 dark:hover:border-pink-500 dark:hover:ring-pink-800',
  lime:   'hover:bg-lime-50 hover:text-lime-700 hover:border-lime-400 hover:ring-1 hover:ring-lime-200 dark:hover:bg-lime-950/20 dark:hover:text-lime-300 dark:hover:border-lime-500 dark:hover:ring-lime-800',
  teal:   'hover:bg-teal-50 hover:text-teal-700 hover:border-teal-400 hover:ring-1 hover:ring-teal-200 dark:hover:bg-teal-900/20 dark:hover:text-teal-300 dark:hover:border-teal-600 dark:hover:ring-teal-800',
  indigo: 'hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-400 hover:ring-1 hover:ring-indigo-200 dark:hover:bg-indigo-950/20 dark:hover:text-indigo-300 dark:hover:border-indigo-500 dark:hover:ring-indigo-800',
  violet: 'hover:bg-violet-50 hover:text-violet-700 hover:border-violet-400 hover:ring-1 hover:ring-violet-200 dark:hover:bg-violet-950/20 dark:hover:text-violet-300 dark:hover:border-violet-500 dark:hover:ring-violet-800',
};

const STEP_TYPE_ACTIVE: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  purple: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
};

const STEP_TYPE_HOVER: Record<string, string> = {
  blue:   'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 hover:ring-1 hover:ring-blue-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 dark:hover:ring-blue-700',
  purple: 'hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 hover:ring-1 hover:ring-purple-300 dark:hover:bg-purple-900/20 dark:hover:text-purple-300 dark:hover:ring-purple-700',
};

const ICON_COLOR: Record<string, string> = {
  orange: 'text-orange-400 dark:text-orange-500',
  lime:   'text-lime-500 dark:text-lime-400',
  teal:   'text-teal-500 dark:text-teal-400',
  indigo: 'text-indigo-500 dark:text-indigo-400',
  violet: 'text-violet-500 dark:text-violet-400',
};

// Icons shown inside CM0 buttons only — other CMs have no per-button icon.
const EXECUTOR_ICON: Partial<Record<string, React.ReactNode>> = {
  human:  <User className="h-3 w-3 shrink-0" />,
  script: <Terminal className="h-3 w-3 shrink-0" />,
  action: <Zap className="h-3 w-3 shrink-0" />,
};

function CMRowIcon({ cm, color }: { cm: CMRow['cm']; color: string }) {
  const iconCls = cn('h-4 w-4', ICON_COLOR[color]);
  if (cm === 'CM0') return <User className={iconCls} />;
  if (cm === 'CM1') return (
    <>
      <User className={cn(iconCls, 'shrink-0')} />
      <span className="relative inline-flex shrink-0 mr-2">
        <Bot className={iconCls} />
        <Search className={cn('absolute -bottom-0.5 -right-1.5 h-2.5 w-2.5', ICON_COLOR[color])} strokeWidth={2.5} />
      </span>
    </>
  );
  if (cm === 'CM2') return (
    <>
      <User className={cn(iconCls, 'shrink-0')} />
      <Bot className={cn(iconCls, 'shrink-0')} />
    </>
  );
  if (cm === 'CM3') return (
    <>
      <Bot className={cn(iconCls, 'shrink-0')} />
      <span className="relative inline-flex shrink-0 mr-2">
        <User className={iconCls} />
        <Search className={cn('absolute -bottom-0.5 -right-1.5 h-2.5 w-2.5', ICON_COLOR[color])} strokeWidth={2.5} />
      </span>
    </>
  );
  return <Bot className={iconCls} />;
}

type Props = {
  position: { top: number; left: number };
  onAdd: (payload: NewStepPayload) => void;
  onClose: () => void;
};

export function BlockPicker({ position, onAdd, onClose }: Props) {
  const [pendingType, setPendingType] = useState<'creation' | 'decision'>('creation');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  const handleAdd = (payload: NewStepPayload) => {
    onAdd({ ...payload, type: pendingType });
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
        zIndex: 9999,
      }}
      className="bg-background border rounded-xl shadow-xl p-3 w-[500px] space-y-3"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Add new step</p>

      {/* Step type */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">What do you want to do in this step?</p>
        <div className="flex gap-2">
          {STEP_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={(e) => { e.stopPropagation(); setPendingType(opt.value); }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold border transition-all whitespace-nowrap',
                pendingType === opt.value ? STEP_TYPE_ACTIVE[opt.color] : STEP_TYPE_HOVER[opt.color],
              )}
            >
              {opt.value === 'creation'
                ? <PenLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                : <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* CM rows */}
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Who executes this step?</p>
        {CM_ROWS.map((row) => (
          <div
            key={row.cm}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-border/40 px-2.5 py-1.5',
              row.disabled && 'opacity-50',
            )}
          >
            <span className="w-14 shrink-0 flex items-center gap-0.5">
              <CMRowIcon cm={row.cm} color={row.color} />
            </span>
            <div className="flex gap-1.5 shrink-0">
              {row.buttons.map((btn) => (
                <button
                  key={btn.label}
                  disabled={row.disabled}
                  onClick={(e) => { e.stopPropagation(); handleAdd(btn.payload); }}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap',
                    row.cm !== 'CM0' && 'w-36 text-left',
                    row.disabled ? 'cursor-not-allowed' : BUTTON_CLASSES[btn.color],
                  )}
                >
                  {EXECUTOR_ICON[btn.payload.executor]}
                  {btn.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {row.disabled
                ? <>{row.description.replace(' — coming soon', '')} — <em>coming soon</em></>
                : row.description}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
