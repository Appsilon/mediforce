'use client';

import React, { useState } from 'react';
import { User, Users, Bot, Terminal, Zap, PenLine, GitBranch, Search, Mail, Globe, Clock, CheckSquare, Wand2 } from 'lucide-react';
import { BLOCK_PRESETS, BLOCK_CATEGORIES, type BlockCategory, type BlockPreset } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { useCapabilities } from '@/hooks/use-capabilities';
import { CONTROL_MODE_LABELS, CONTROL_MODE_NUMBER, CONTROL_MODE_DISABLED, type ControlMode, type Executor, type NewStepPayload } from '@/lib/control-mode';
import { CM_ROWS, STEP_TYPE_OPTIONS, type CMRow } from '@/lib/block-presets';

/** Which tier of the picker is showing. Simple opens first — most adds are ordinary. */
type Tier = 'simple' | 'full';

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  people: 'People',
  communicate: 'Communicate',
  data: 'Data',
  ai: 'AI',
  control: 'Control',
};

const PRESET_ICON: Record<string, React.ReactNode> = {
  'collect-input': <User className="h-3.5 w-3.5 shrink-0" />,
  'ask-for-approval': <CheckSquare className="h-3.5 w-3.5 shrink-0" />,
  'send-email': <Mail className="h-3.5 w-3.5 shrink-0" />,
  'run-script': <Terminal className="h-3.5 w-3.5 shrink-0" />,
  'call-api': <Globe className="h-3.5 w-3.5 shrink-0" />,
  'transform-data': <Wand2 className="h-3.5 w-3.5 shrink-0" />,
  'agent-drafts-person-approves': <Bot className="h-3.5 w-3.5 shrink-0" />,
  'work-with-an-agent-live': <Users className="h-3.5 w-3.5 shrink-0" />,
  'route-by-condition': <GitBranch className="h-3.5 w-3.5 shrink-0" />,
  'wait': <Clock className="h-3.5 w-3.5 shrink-0" />,
  'run-another-workflow': <Zap className="h-3.5 w-3.5 shrink-0" />,
};

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

const EXECUTOR_ICON: Record<Executor, React.ReactNode> = {
  human:  <User className="h-3.5 w-3.5 shrink-0" />,
  script: <Terminal className="h-3.5 w-3.5 shrink-0" />,
  action: <Zap className="h-3.5 w-3.5 shrink-0" />,
  cowork: <Users className="h-3.5 w-3.5 shrink-0" />,
  agent:  <Bot className="h-3.5 w-3.5 shrink-0" />,
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

/**
 * One pre-made block. Unavailable blocks stay visible but greyed, with the
 * reason on hover — hiding them would leave the author wondering whether the
 * platform can do it at all.
 */
function PresetButton({ preset, unavailableReason, detail, onPick }: {
  preset: BlockPreset;
  unavailableReason: string | null;
  detail: string | undefined;
  onPick: () => void;
}) {
  const unavailable = unavailableReason !== null;
  return (
    <span className="group relative block">
      <button
        data-testid={`preset-option-${preset.id}`}
        disabled={unavailable}
        onClick={onPick}
        className={cn(
          'w-full flex items-start gap-2 rounded-lg py-1.5 px-2.5 text-left border transition-all',
          unavailable
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-muted hover:border-foreground/30 cursor-pointer',
        )}
      >
        <span className="mt-0.5 text-muted-foreground">{PRESET_ICON[preset.id]}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-semibold">{preset.label}</span>
            {detail !== undefined && (
              <span className="rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                {detail}
              </span>
            )}
          </span>
          <span className="block text-[10px] leading-snug text-muted-foreground">{preset.purpose}</span>
        </span>
      </button>
      {unavailable && (
        <span className="pointer-events-none absolute left-2 right-2 top-full z-50 mt-1 rounded-md border bg-popover px-2.5 py-2 text-[10px] leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
          {unavailableReason}
        </span>
      )}
    </span>
  );
}

export function BlockPicker({ onAdd }: Props) {
  const [tier, setTier] = useState<Tier>('simple');
  const [pendingType, setPendingType] = useState<'creation' | 'decision'>('creation');
  const { capabilities } = useCapabilities();

  const handleAdd = (payload: Omit<NewStepPayload, 'type'>) => {
    onAdd({ ...payload, type: pendingType });
  };

  // Unknown capabilities (endpoint unreachable) read as available — a picker
  // that greys everything out because one fetch failed is the worse failure.
  const statusFor = (preset: BlockPreset) => {
    if (preset.requires === undefined || capabilities === null) return null;
    return capabilities[preset.requires] ?? null;
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Tier — pre-made blocks, or the full executor picker */}
      <div className="flex rounded-lg border p-0.5">
        {(['simple', 'full'] as const).map((value) => (
          <button
            key={value}
            data-testid={`picker-tier-${value}`}
            onClick={() => setTier(value)}
            className={cn(
              'flex-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer',
              tier === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {value === 'simple' ? 'Simple' : 'Full'}
          </button>
        ))}
      </div>

      {tier === 'simple' && (
        <div className="space-y-4">
          {BLOCK_CATEGORIES.map((category) => {
            const presets = BLOCK_PRESETS.filter((preset) => preset.category === category);
            if (presets.length === 0) return null;
            return (
              <div key={category} className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {CATEGORY_LABELS[category]}
                </p>
                {presets.map((preset) => {
                  const status = statusFor(preset);
                  const unavailable = status !== null && status.available === false;
                  return (
                    <PresetButton
                      key={preset.id}
                      preset={preset}
                      unavailableReason={unavailable ? (status.reason ?? 'Not available on this instance.') : null}
                      detail={status?.available === true ? status.detail : undefined}
                      onPick={() => onAdd(preset.payload)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {tier === 'full' && (
      <>
      {/* Step type */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Step type</p>
        <div className="flex gap-2">
          {STEP_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              data-testid={`step-type-option-${opt.value}`}
              onClick={() => setPendingType(opt.value)}
              className={cn(
                'flex-1 flex items-start gap-2 rounded-lg py-1.5 px-2.5 text-left border transition-all',
                pendingType === opt.value ? STEP_TYPE_ACTIVE[opt.color] : STEP_TYPE_HOVER[opt.color],
              )}
            >
              <span className="mt-0.5">
                {opt.value === 'creation'
                  ? <PenLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  : <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{opt.label}</span>
                <span className="block text-[10px] leading-snug text-muted-foreground">{opt.purpose}</span>
              </span>
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
            </div>

            <div className="space-y-1.5">
              {row.buttons.map((btn) => (
                <button
                  key={btn.id}
                  data-testid={`executor-option-${btn.id}`}
                  disabled={disabled}
                  onClick={() => handleAdd(btn.payload)}
                  className={cn(
                    'w-full flex items-start gap-2 rounded-lg py-1.5 px-2.5 text-left border transition-all',
                    disabled ? 'cursor-not-allowed' : BUTTON_CLASSES[btn.color],
                  )}
                >
                  <span className="mt-0.5">{EXECUTOR_ICON[btn.payload.executor]}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{btn.label}</span>
                    <span className="block text-[10px] leading-snug text-muted-foreground">{btn.purpose}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
