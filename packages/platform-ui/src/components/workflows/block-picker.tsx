'use client';

import React, { useState } from 'react';
import { User, Bot, Terminal, Zap, PenLine, GitBranch, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTROL_MODE_LABELS, CONTROL_MODE_NUMBER, CONTROL_MODE_DISABLED, type ControlMode, type Executor, type NewStepPayload } from '@/lib/control-mode';
import { CM_ROWS, STEP_TYPE_OPTIONS, type CMRow } from '@/lib/block-presets';

// Inverse of CONTROL_MODE_NUMBER (control mode → CM label), derived so the two
// never drift.
const CM_TO_CONTROL_MODE = Object.fromEntries(
  (Object.entries(CONTROL_MODE_NUMBER) as [ControlMode, string][]).map(([mode, cm]) => [cm, mode]),
) as Record<CMRow['cm'], ControlMode>;

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

const CM_BORDER: Record<string, string> = {
  orange: 'border-orange-200 dark:border-orange-800/60',
  lime:   'border-lime-200 dark:border-lime-800/60',
  teal:   'border-teal-200 dark:border-teal-800/60',
  indigo: 'border-indigo-200 dark:border-indigo-800/60',
  violet: 'border-violet-200 dark:border-violet-800/60',
};

const CM_LABEL_COLOR: Record<string, string> = {
  orange: 'text-orange-600 dark:text-orange-400',
  lime:   'text-lime-600 dark:text-lime-400',
  teal:   'text-teal-600 dark:text-teal-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  violet: 'text-violet-600 dark:text-violet-400',
};

const ICON_COLOR: Record<string, string> = {
  orange: 'text-orange-400 dark:text-orange-500',
  lime:   'text-lime-500 dark:text-lime-400',
  teal:   'text-teal-500 dark:text-teal-400',
  indigo: 'text-indigo-500 dark:text-indigo-400',
  violet: 'text-violet-500 dark:text-violet-400',
};

const EXECUTOR_ICON: Partial<Record<Executor, React.ReactNode>> = {
  human:  <User className="h-3 w-3 shrink-0" />,
  script: <Terminal className="h-3 w-3 shrink-0" />,
  action: <Zap className="h-3 w-3 shrink-0" />,
};

function CMRowIcon({ cm, color }: { cm: CMRow['cm']; color: string }) {
  const iconCls = cn('h-3.5 w-3.5', ICON_COLOR[color]);
  if (cm === 'CM0') return <User className={iconCls} />;
  if (cm === 'CM1') return (
    <>
      <User className={cn(iconCls, 'shrink-0')} />
      <span className="relative inline-flex shrink-0">
        <Bot className={iconCls} />
        <Search className={cn('absolute -bottom-0.5 -right-1.5 h-2 w-2', ICON_COLOR[color])} strokeWidth={2.5} />
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
      <span className="relative inline-flex shrink-0">
        <User className={iconCls} />
        <Search className={cn('absolute -bottom-0.5 -right-1.5 h-2 w-2', ICON_COLOR[color])} strokeWidth={2.5} />
      </span>
    </>
  );
  return <Bot className={iconCls} />;
}

type Props = {
  onAdd: (payload: NewStepPayload) => void;
};

export function BlockPicker({ onAdd }: Props) {
  const [pendingType, setPendingType] = useState<'creation' | 'decision'>('creation');

  const handleAdd = (payload: Omit<NewStepPayload, 'type'>) => {
    onAdd({ ...payload, type: pendingType });
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Step type */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Step type</p>
        <div className="flex gap-2">
          {STEP_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPendingType(opt.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold border transition-all whitespace-nowrap flex-1 justify-center',
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

      {/* CM rows — stacked cards, one per control mode */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Executor</p>
        {CM_ROWS.map((row) => {
          const controlMode = CM_TO_CONTROL_MODE[row.cm];
          const disabled = CONTROL_MODE_DISABLED[controlMode];
          return (
          <div
            key={row.cm}
            className={cn(
              'rounded-xl border px-3 py-2.5 space-y-2 transition-opacity',
              CM_BORDER[row.color],
              disabled && 'opacity-50',
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex items-center gap-0.5 shrink-0">
                <CMRowIcon cm={row.cm} color={row.color} />
              </span>
              <span className={cn('text-[11px] font-bold shrink-0', CM_LABEL_COLOR[row.color])}>
                {CONTROL_MODE_LABELS[controlMode]}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                {disabled
                  ? <>{row.description.replace(' — coming soon', '')} — <em>coming soon</em></>
                  : row.description}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {row.buttons.map((btn) => (
                <button
                  key={btn.label}
                  disabled={disabled}
                  onClick={() => handleAdd(btn.payload)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-lg py-1 px-2.5 text-xs font-semibold border transition-all whitespace-nowrap',
                    disabled ? 'cursor-not-allowed' : BUTTON_CLASSES[btn.color],
                  )}
                >
                  {EXECUTOR_ICON[btn.payload.executor]}
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
