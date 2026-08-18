'use client';

import React, { useRef, useState } from 'react';
import { User, Bot, Terminal, PenLine, GitBranch, Search, Mail, Plus, X } from 'lucide-react';
import { BLOCK_PRESETS, BLOCK_CATEGORIES, type BlockCategory, type BlockPreset } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { useCapabilities } from '@/hooks/use-capabilities';
import { CollapsibleCard } from './workflow-editor/collapsible-card';
import { CONTROL_MODE_LABELS, CONTROL_MODE_NUMBER, CONTROL_MODE_DISABLED, getControlMode, type ControlMode, type NewStepPayload } from '@/lib/control-mode';
import { STEP_STYLES, STEP_TYPE_CONFIG, ExecutorIcon, getExecutorLabel } from './workflow-diagram';
import { CM_ROWS, STEP_TYPE_OPTIONS, type CMRow } from '@/lib/block-presets';

/** Which tier of the picker is showing. Simple opens first — most adds are ordinary. */
type Tier = 'simple' | 'full';

// Each category is a card in the same shape as a control-mode row: coloured
// border, coloured label with an icon, options stacked inside.
const CATEGORY_LABELS: Record<BlockCategory, string> = {
  people: 'People',
  communicate: 'Communicate',
  data: 'Data',
  ai: 'AI',
  control: 'Control',
};

const CATEGORY_COLOR: Record<BlockCategory, string> = {
  people: 'orange',
  communicate: 'pink',
  data: 'yellow',
  ai: 'violet',
  control: 'teal',
};

const CATEGORY_ICON: Record<BlockCategory, React.ComponentType<{ className?: string }>> = {
  people: User,
  communicate: Mail,
  data: Terminal,
  ai: Bot,
  control: GitBranch,
};

// Inverse of CONTROL_MODE_NUMBER (control mode → CM label), derived so the two
// never drift.
const CM_TO_CONTROL_MODE = Object.fromEntries(
  (Object.entries(CONTROL_MODE_NUMBER) as [ControlMode, string][]).map(([mode, cm]) => [cm, mode]),
) as Record<CMRow['cm'], ControlMode>;

const STEP_TYPE_ACTIVE: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  purple: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
};

const STEP_TYPE_HOVER: Record<string, string> = {
  blue:   'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 hover:ring-1 hover:ring-blue-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 dark:hover:ring-blue-700',
  purple: 'hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 hover:ring-1 hover:ring-purple-300 dark:hover:bg-purple-900/20 dark:hover:text-purple-300 dark:hover:ring-purple-700',
};

// Keyed by colour, not by control mode — both tiers label their section cards
// the same way, so both read from these.
const CM_LABEL_COLOR: Record<string, string> = {
  orange: 'text-orange-600 dark:text-orange-400',
  yellow: 'text-yellow-600 dark:text-yellow-400',
  pink:   'text-pink-600 dark:text-pink-400',
  lime:   'text-lime-600 dark:text-lime-400',
  teal:   'text-teal-600 dark:text-teal-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  violet: 'text-violet-600 dark:text-violet-400',
};

const ICON_COLOR: Record<string, string> = {
  orange: 'text-orange-400 dark:text-orange-500',
  yellow: 'text-yellow-500 dark:text-yellow-400',
  pink:   'text-pink-500 dark:text-pink-400',
  lime:   'text-lime-500 dark:text-lime-400',
  teal:   'text-teal-500 dark:text-teal-400',
  indigo: 'text-indigo-500 dark:text-indigo-400',
  violet: 'text-violet-500 dark:text-violet-400',
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
  onClose: () => void;
  /** Inserting between two existing steps rather than appending. */
  onEdge?: boolean;
};

/**
 * A block drawn the way the canvas draws it: same rounded chrome, same executor
 * row, same step-type tint. What you pick is what you get.
 */
function BlockNodePreview({ label, executor, autonomyLevel, stepType, badge, dimmed }: {
  label: string;
  executor: string;
  autonomyLevel?: string;
  stepType: string;
  badge?: string;
  dimmed?: boolean;
}) {
  const style = STEP_STYLES[stepType] ?? STEP_STYLES.creation;
  const typeConfig = STEP_TYPE_CONFIG[stepType] ?? STEP_TYPE_CONFIG.creation;
  const mode = getControlMode(executor, autonomyLevel);
  return (
    <span
      className={cn(
        'block rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-shadow',
        style.bg,
        style.border,
        dimmed ? 'opacity-50' : 'group-hover:shadow-md',
      )}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <ExecutorIcon executor={executor} autonomyLevel={autonomyLevel} />
        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
          {getExecutorLabel(executor, mode)}
        </span>
        <span className="text-muted-foreground/40 text-[10px] shrink-0">&middot;</span>
        <span className={cn('text-[10px] font-semibold truncate', typeConfig.color)}>
          {typeConfig.label}
        </span>
        {badge !== undefined && (
          <span className="ml-auto shrink-0 rounded border px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-2 block text-[12px] font-semibold leading-snug text-foreground line-clamp-2">
        {label}
      </span>
    </span>
  );
}

/**
 * An option plus its description.
 *
 * The description flies out to the left on hover, positioned `fixed` so it is
 * never clipped by the panel's scroll container and always sits above the
 * canvas. A screen-reader copy stays inside the button so the description is
 * still attached to the control it explains.
 */
function OptionButton({ testId, disabled, onPick, description, children }: {
  testId: string;
  disabled: boolean;
  onPick: () => void;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.top, left: rect.left });
  };
  const hide = () => setAnchor(null);

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={onPick}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn('group relative block w-full', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
      >
        {children}
        <span className="sr-only">{description}</span>
      </button>
      {anchor !== null && (
        <div
          style={{ position: 'fixed', top: anchor.top, left: anchor.left - 8, transform: 'translateX(-100%)' }}
          className="pointer-events-none z-[200] w-64 rounded-md border bg-popover px-2.5 py-2 text-[10px] leading-relaxed text-popover-foreground shadow-md"
        >
          {description}
        </div>
      )}
    </>
  );
}

export function BlockPicker({ onAdd, onClose, onEdge = false }: Props) {
  const [tier, setTier] = useState<Tier>('simple');
  const [pendingType, setPendingType] = useState<'creation' | 'decision'>('creation');
  // One section at a time, first open — the step editor's accordion. Cards size
  // to their content so a one-option section does not stretch down the panel.
  const [openSection, setOpenSection] = useState<string>(BLOCK_CATEGORIES[0]);
  const { capabilities } = useCapabilities();

  const isOpen = (key: string) => openSection === key;
  const toggle = (key: string) => setOpenSection((current) => (current === key ? '' : key));

  const switchTier = (next: Tier) => {
    setTier(next);
    setOpenSection(next === 'simple' ? BLOCK_CATEGORIES[0] : CM_ROWS[0].cm);
  };

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
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {/* Header card — title, close, tier, and (in Full) the step type */}
      <div className="shrink-0 rounded-xl border shadow-lg bg-white dark:bg-background overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <Plus className="h-4 w-4 text-primary shrink-0" />
          <span className="flex-1 min-w-0 truncate text-sm font-semibold">
            {onEdge ? 'Insert step' : 'Add block'}
          </span>
          {onEdge && <span className="shrink-0 text-[10px] text-muted-foreground">on edge</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="border-t px-4 py-3 space-y-2.5">
          <div className="flex rounded-lg border p-0.5">
            {(['simple', 'full'] as const).map((value) => (
              <button
                key={value}
                data-testid={`picker-tier-${value}`}
                onClick={() => switchTier(value)}
                className={cn(
                  'flex-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer',
                  tier === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'simple' ? 'Simple' : 'Full'}
              </button>
            ))}
          </div>

          {tier === 'full' && (
            <div className="flex gap-2">
              {STEP_TYPE_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  testId={`step-type-option-${opt.value}`}
                  disabled={false}
                  onPick={() => setPendingType(opt.value)}
                  description={opt.purpose}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg py-1.5 px-2.5 border transition-all',
                      pendingType === opt.value ? STEP_TYPE_ACTIVE[opt.color] : STEP_TYPE_HOVER[opt.color],
                    )}
                  >
                    {opt.value === 'creation'
                      ? <PenLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      : <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-left">{opt.label}</span>
                  </span>
                </OptionButton>
              ))}
            </div>
          )}
        </div>
      </div>

      {tier === 'simple' && BLOCK_CATEGORIES.map((category) => {
        const presets = BLOCK_PRESETS.filter((preset) => preset.category === category);
        if (presets.length === 0) return null;
        const color = CATEGORY_COLOR[category];
        const CategoryIcon = CATEGORY_ICON[category];
        return (
          <CollapsibleCard
            key={category}
            testId={`section-${category}`}
            fill={false}
            open={isOpen(category)}
            onToggle={() => toggle(category)}
            titleNode={
              <>
                <CategoryIcon className={cn('h-3.5 w-3.5 shrink-0', ICON_COLOR[color])} />
                <span className={cn('text-[11px] font-bold shrink-0', CM_LABEL_COLOR[color])}>
                  {CATEGORY_LABELS[category]}
                </span>
              </>
            }
          >
            <div className="space-y-2">
              {presets.map((preset) => {
                const status = statusFor(preset);
                const unavailable = status !== null && status.available === false;
                return (
                  <OptionButton
                    key={preset.id}
                    testId={`preset-option-${preset.id}`}
                    disabled={unavailable}
                    onPick={() => onAdd(preset.payload)}
                    description={
                      <>
                        {preset.purpose}
                        {unavailable && (
                          <span className="mt-1.5 block text-muted-foreground">
                            {status?.reason ?? 'Not available on this instance.'}
                          </span>
                        )}
                      </>
                    }
                  >
                    <BlockNodePreview
                      label={preset.label}
                      executor={preset.payload.executor}
                      autonomyLevel={preset.payload.autonomyLevel}
                      stepType={preset.payload.type ?? 'creation'}
                      badge={status?.available === true ? status.detail : undefined}
                      dimmed={unavailable}
                    />
                  </OptionButton>
                );
              })}
            </div>
          </CollapsibleCard>
        );
      })}

      {/* One card per control mode, so Full folds the same way Simple does. */}
      {tier === 'full' && CM_ROWS.map((row) => {
        const controlMode = CM_TO_CONTROL_MODE[row.cm];
        const disabled = CONTROL_MODE_DISABLED[controlMode];
        return (
          <CollapsibleCard
            key={row.cm}
            testId={`section-${row.cm}`}
            fill={false}
            open={isOpen(row.cm)}
            onToggle={() => toggle(row.cm)}
            titleNode={
              <>
                <span className="flex items-center gap-0.5 shrink-0">
                  <CMRowIcon cm={row.cm} color={row.color} />
                </span>
                <span className={cn('text-[11px] font-bold shrink-0', CM_LABEL_COLOR[row.color])}>
                  {CONTROL_MODE_LABELS[controlMode]}
                </span>
              </>
            }
          >
            <div className="space-y-2">
              {row.buttons.map((btn) => (
                <OptionButton
                  key={btn.id}
                  testId={`executor-option-${btn.id}`}
                  disabled={disabled}
                  onPick={() => handleAdd(btn.payload)}
                  description={btn.purpose}
                >
                  <BlockNodePreview
                    label={btn.label}
                    executor={btn.payload.executor}
                    autonomyLevel={btn.payload.autonomyLevel}
                    stepType={pendingType}
                    dimmed={disabled}
                  />
                </OptionButton>
              ))}
            </div>
          </CollapsibleCard>
        );
      })}
    </div>
  );
}
