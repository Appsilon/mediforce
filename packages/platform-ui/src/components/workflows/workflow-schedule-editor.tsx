'use client';

import * as React from 'react';
import { Plus, Trash2, Save, Clock, ChevronDown, ChevronUp, AlertCircle, Check, Play } from 'lucide-react';
import { formatCron } from '@/lib/format-cron';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { saveWorkflowDefinition } from '@/app/actions/definitions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Trigger {
  type: 'manual' | 'webhook' | 'event' | 'cron';
  name: string;
  config?: Record<string, unknown>;
  schedule?: string;
}

type Frequency = 'every-15-min' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

interface CronPreset {
  frequency: Frequency;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
}

// ---------------------------------------------------------------------------
// Cron utilities (no external deps)
// ---------------------------------------------------------------------------

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function presetToCron(preset: CronPreset): string {
  const mm = String(preset.minute);
  const hh = String(preset.hour);
  switch (preset.frequency) {
    case 'every-15-min':
      return '*/15 * * * *';
    case 'hourly':
      return `${mm} * * * *`;
    case 'daily':
      return `${mm} ${hh} * * *`;
    case 'weekdays':
      return `${mm} ${hh} * * 1-5`;
    case 'weekly':
      return `${mm} ${hh} * * ${preset.dayOfWeek}`;
    case 'monthly':
      return `${mm} ${hh} ${preset.dayOfMonth} * *`;
  }
}

function cronToPreset(cron: string): CronPreset | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, , dow] = parts;

  if (cron === '*/15 * * * *') {
    return { frequency: 'every-15-min', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1 };
  }
  if (hour === '*' && dom === '*' && dow === '*') {
    return { frequency: 'hourly', hour: 0, minute: Number(minute), dayOfWeek: 0, dayOfMonth: 1 };
  }
  if (dom === '*' && dow === '1-5') {
    return { frequency: 'weekdays', hour: Number(hour), minute: Number(minute), dayOfWeek: 0, dayOfMonth: 1 };
  }
  if (dom === '*' && dow === '*') {
    return { frequency: 'daily', hour: Number(hour), minute: Number(minute), dayOfWeek: 0, dayOfMonth: 1 };
  }
  if (dom === '*' && /^\d$/.test(dow)) {
    return { frequency: 'weekly', hour: Number(hour), minute: Number(minute), dayOfWeek: Number(dow), dayOfMonth: 1 };
  }
  if (/^\d+$/.test(dom) && dow === '*') {
    return { frequency: 'monthly', hour: Number(hour), minute: Number(minute), dayOfWeek: 0, dayOfMonth: Number(dom) };
  }

  return null;
}

function validateCronLocal(schedule: string): { valid: boolean; error?: string } {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: `Expected 5 fields, got ${fields.length}` };
  }

  // Validate minute field for 15-minute alignment
  const minuteField = fields[0];
  const minuteValues = expandField(minuteField, 0, 59);
  if (typeof minuteValues === 'string') {
    return { valid: false, error: `minute: ${minuteValues}` };
  }
  const invalidMinutes = minuteValues.filter((m) => m % 15 !== 0);
  if (invalidMinutes.length > 0) {
    return {
      valid: false,
      error: `Minute values must be divisible by 15 (0, 15, 30, 45). Invalid: ${invalidMinutes.join(', ')}`,
    };
  }

  // Basic validation for remaining fields
  const ranges: Array<[string, number, number]> = [
    [fields[1], 0, 23],
    [fields[2], 1, 31],
    [fields[3], 1, 12],
    [fields[4], 0, 6],
  ];
  const names = ['hour', 'day-of-month', 'month', 'day-of-week'];
  for (let i = 0; i < ranges.length; i++) {
    const result = expandField(ranges[i][0], ranges[i][1], ranges[i][2]);
    if (typeof result === 'string') {
      return { valid: false, error: `${names[i]}: ${result}` };
    }
  }

  return { valid: true };
}

function expandField(field: string, min: number, max: number): number[] | string {
  if (field === '*') {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  if (field.includes('/')) {
    const [range, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (Number.isNaN(step) || step < 1) return `Invalid step: ${stepStr}`;
    let start = min;
    let end = max;
    if (range !== '*') {
      if (range.includes('-')) {
        const [lo, hi] = range.split('-').map(Number);
        if (Number.isNaN(lo) || Number.isNaN(hi)) return `Invalid range: ${range}`;
        start = lo;
        end = hi;
      } else {
        start = parseInt(range, 10);
        if (Number.isNaN(start)) return `Invalid value: ${range}`;
      }
    }
    if (start < min || end > max) return `Out of range [${min}-${max}]: ${field}`;
    const values: number[] = [];
    for (let i = start; i <= end; i += step) values.push(i);
    return values;
  }
  const parts = field.split(',');
  const values: number[] = [];
  for (const part of parts) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (Number.isNaN(lo) || Number.isNaN(hi)) return `Invalid range: ${part}`;
      if (lo < min || hi > max) return `Out of range [${min}-${max}]: ${part}`;
      for (let i = lo; i <= hi; i++) values.push(i);
    } else {
      const num = parseInt(part, 10);
      if (Number.isNaN(num)) return `Invalid value: ${part}`;
      if (num < min || num > max) return `Out of range [${min}-${max}]: ${part}`;
      values.push(num);
    }
  }
  return values;
}

/** Compute next N UTC matches for a cron expression, starting from `now`. */
function computeNextRuns(schedule: string, count: number, now: Date = new Date()): Date[] {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return [];

  const minutes = expandField(fields[0], 0, 59);
  const hours = expandField(fields[1], 0, 23);
  const daysOfMonth = expandField(fields[2], 1, 31);
  const months = expandField(fields[3], 1, 12);
  const daysOfWeek = expandField(fields[4], 0, 6);

  if (
    typeof minutes === 'string' ||
    typeof hours === 'string' ||
    typeof daysOfMonth === 'string' ||
    typeof months === 'string' ||
    typeof daysOfWeek === 'string'
  ) {
    return [];
  }

  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const domSet = new Set(daysOfMonth);
  const monthSet = new Set(months);
  const dowSet = new Set(daysOfWeek);

  const results: Date[] = [];
  // Start from the next minute boundary after now
  const cursor = new Date(now.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // Search up to ~1 year ahead to avoid infinite loops
  const maxIterations = 366 * 24 * 60;
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    const m = cursor.getUTCMinutes();
    const h = cursor.getUTCHours();
    const dom = cursor.getUTCDate();
    const mon = cursor.getUTCMonth() + 1;
    const dow = cursor.getUTCDay();

    if (minuteSet.has(m) && hourSet.has(h) && domSet.has(dom) && monthSet.has(mon) && dowSet.has(dow)) {
      results.push(new Date(cursor.getTime()));
    }

    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    iterations++;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WorkflowScheduleEditorProps {
  definition: WorkflowDefinition;
}

export function WorkflowScheduleEditor({ definition }: WorkflowScheduleEditorProps) {
  const currentTriggers: Trigger[] = definition.triggers ?? [];
  const cronTriggers = currentTriggers.filter((t) => t.type === 'cron');
  const hasManual = currentTriggers.some((t) => t.type === 'manual');
  const otherTriggers = currentTriggers.filter((t) => t.type !== 'cron' && t.type !== 'manual');

  const [manualEnabled, setManualEnabled] = React.useState(hasManual);
  const [cronEntries, setCronEntries] = React.useState<Array<CronEntry>>(() =>
    cronTriggers.map((t) => ({
      id: crypto.randomUUID(),
      name: t.name,
      schedule: t.schedule ?? '0 * * * *',
      preset: cronToPreset(t.schedule ?? '0 * * * *'),
      advancedMode: cronToPreset(t.schedule ?? '0 * * * *') === null,
    })),
  );

  const [saving, setSaving] = React.useState(false);
  const [saveResult, setSaveResult] = React.useState<{ success: boolean; message: string } | null>(null);

  const hasChanges = React.useMemo(() => {
    if (manualEnabled !== hasManual) return true;
    if (cronEntries.length !== cronTriggers.length) return true;
    for (let i = 0; i < cronEntries.length; i++) {
      const entry = cronEntries[i];
      const original = cronTriggers[i];
      if (entry.name !== original.name || entry.schedule !== original.schedule) return true;
    }
    return false;
  }, [manualEnabled, hasManual, cronEntries, cronTriggers]);

  function addCronTrigger() {
    setCronEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: `cron-${prev.length + 1}`,
        schedule: '0 * * * *',
        preset: { frequency: 'hourly', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1 },
        advancedMode: false,
      },
    ]);
    setSaveResult(null);
  }

  function removeCronEntry(id: string) {
    setCronEntries((prev) => prev.filter((e) => e.id !== id));
    setSaveResult(null);
  }

  function updateCronEntry(id: string, updates: Partial<CronEntry>) {
    setCronEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    );
    setSaveResult(null);
  }

  async function handleSave() {
    // Validate all cron entries
    for (const entry of cronEntries) {
      const result = validateCronLocal(entry.schedule);
      if (!result.valid) {
        setSaveResult({ success: false, message: `Invalid schedule for "${entry.name}": ${result.error}` });
        return;
      }
    }

    // Check that we have at least one trigger
    const newTriggers: Trigger[] = [];
    if (manualEnabled) {
      newTriggers.push({ type: 'manual', name: 'manual' });
    }
    for (const entry of cronEntries) {
      newTriggers.push({ type: 'cron', name: entry.name, schedule: entry.schedule });
    }
    for (const t of otherTriggers) {
      newTriggers.push(t);
    }

    if (newTriggers.length === 0) {
      setSaveResult({ success: false, message: 'At least one trigger is required.' });
      return;
    }

    setSaving(true);
    setSaveResult(null);

    // Build the new definition (without version/createdAt — saveWorkflowDefinition handles those)
    const { version: _version, createdAt: _createdAt, ...rest } = definition;
    const result = await saveWorkflowDefinition({
      ...rest,
      triggers: newTriggers,
    });

    setSaving(false);

    if (result.success) {
      setSaveResult({ success: true, message: `Saved as version ${result.version}.` });
    } else {
      setSaveResult({ success: false, message: result.error });
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Manual trigger toggle */}
      <div className="rounded-lg border p-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Allow manual runs</div>
              <div className="text-xs text-muted-foreground">Users can start this workflow manually</div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={manualEnabled}
            onClick={() => { setManualEnabled((prev) => !prev); setSaveResult(null); }}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              manualEnabled ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform',
                manualEnabled ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </label>
      </div>

      {/* Cron triggers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Scheduled triggers</h3>
          </div>
          <button
            onClick={addCronTrigger}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add schedule
          </button>
        </div>

        {cronEntries.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Clock className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No scheduled triggers</p>
            <p className="text-xs text-muted-foreground mt-1">Add a schedule to run this workflow automatically</p>
          </div>
        )}

        {cronEntries.map((entry) => (
          <CronEntryEditor
            key={entry.id}
            entry={entry}
            onUpdate={(updates) => updateCronEntry(entry.id, updates)}
            onRemove={() => removeCronEntry(entry.id)}
          />
        ))}
      </div>

      {/* Save */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="text-sm">
          {saveResult !== null && (
            <span className={cn(
              'inline-flex items-center gap-1.5',
              saveResult.success ? 'text-green-600' : 'text-destructive',
            )}>
              {saveResult.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {saveResult.message}
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save schedule'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cron entry editor
// ---------------------------------------------------------------------------

interface CronEntry {
  id: string;
  name: string;
  schedule: string;
  preset: CronPreset | null;
  advancedMode: boolean;
}

const FREQUENCY_OPTIONS: Array<{ value: Frequency; label: string }> = [
  { value: 'every-15-min', label: 'Every 15 minutes' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const MINUTE_OPTIONS = [0, 15, 30, 45];

function CronEntryEditor({
  entry,
  onUpdate,
  onRemove,
}: {
  entry: CronEntry;
  onUpdate: (updates: Partial<CronEntry>) => void;
  onRemove: () => void;
}) {
  const validation = validateCronLocal(entry.schedule);
  const nextRuns = React.useMemo(() => computeNextRuns(entry.schedule, 5), [entry.schedule]);

  function setPresetAndSchedule(newPreset: CronPreset) {
    const schedule = presetToCron(newPreset);
    onUpdate({ preset: newPreset, schedule });
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      {/* Header: name + delete */}
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={entry.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className={cn(
            'flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none',
            'focus:ring-1 focus:ring-ring focus:border-ring',
          )}
          placeholder="Trigger name"
        />
        <button
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Remove trigger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Frequency selector (preset mode) */}
      {!entry.advancedMode && entry.preset !== null && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Frequency</label>
            <select
              value={entry.preset.frequency}
              onChange={(e) => {
                const frequency = e.target.value as Frequency;
                setPresetAndSchedule({ ...entry.preset!, frequency });
              }}
              className={cn(
                'rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none',
                'focus:ring-1 focus:ring-ring focus:border-ring',
              )}
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Time picker — shown for daily, weekdays, weekly, monthly */}
            {entry.preset.frequency !== 'every-15-min' && entry.preset.frequency !== 'hourly' && (
              <>
                <label className="text-xs text-muted-foreground ml-2">at</label>
                <select
                  value={entry.preset.hour}
                  onChange={(e) => setPresetAndSchedule({ ...entry.preset!, hour: Number(e.target.value) })}
                  className={cn(
                    'rounded-md border bg-background px-2 py-1.5 text-sm outline-none',
                    'focus:ring-1 focus:ring-ring focus:border-ring',
                  )}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-sm">:</span>
                <select
                  value={entry.preset.minute}
                  onChange={(e) => setPresetAndSchedule({ ...entry.preset!, minute: Number(e.target.value) })}
                  className={cn(
                    'rounded-md border bg-background px-2 py-1.5 text-sm outline-none',
                    'focus:ring-1 focus:ring-ring focus:border-ring',
                  )}
                >
                  {MINUTE_OPTIONS.map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">UTC</span>
              </>
            )}

            {/* Minute picker for hourly */}
            {entry.preset.frequency === 'hourly' && (
              <>
                <label className="text-xs text-muted-foreground ml-2">at minute</label>
                <select
                  value={entry.preset.minute}
                  onChange={(e) => setPresetAndSchedule({ ...entry.preset!, minute: Number(e.target.value) })}
                  className={cn(
                    'rounded-md border bg-background px-2 py-1.5 text-sm outline-none',
                    'focus:ring-1 focus:ring-ring focus:border-ring',
                  )}
                >
                  {MINUTE_OPTIONS.map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
              </>
            )}

            {/* Day of week picker for weekly */}
            {entry.preset.frequency === 'weekly' && (
              <>
                <label className="text-xs text-muted-foreground ml-2">on</label>
                <select
                  value={entry.preset.dayOfWeek}
                  onChange={(e) => setPresetAndSchedule({ ...entry.preset!, dayOfWeek: Number(e.target.value) })}
                  className={cn(
                    'rounded-md border bg-background px-2 py-1.5 text-sm outline-none',
                    'focus:ring-1 focus:ring-ring focus:border-ring',
                  )}
                >
                  {DAYS_OF_WEEK.map((day, i) => (
                    <option key={i} value={i}>{day}</option>
                  ))}
                </select>
              </>
            )}

            {/* Day of month picker for monthly */}
            {entry.preset.frequency === 'monthly' && (
              <>
                <label className="text-xs text-muted-foreground ml-2">on day</label>
                <select
                  value={entry.preset.dayOfMonth}
                  onChange={(e) => setPresetAndSchedule({ ...entry.preset!, dayOfMonth: Number(e.target.value) })}
                  className={cn(
                    'rounded-md border bg-background px-2 py-1.5 text-sm outline-none',
                    'focus:ring-1 focus:ring-ring focus:border-ring',
                  )}
                >
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
      )}

      {/* Advanced mode: raw cron input */}
      {(entry.advancedMode || entry.preset === null) && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Cron expression (5-field, UTC)</label>
          <input
            type="text"
            value={entry.schedule}
            onChange={(e) => {
              const schedule = e.target.value;
              onUpdate({ schedule, preset: cronToPreset(schedule) });
            }}
            className={cn(
              'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm font-mono outline-none',
              'focus:ring-1 focus:ring-ring focus:border-ring',
              !validation.valid && 'border-destructive',
            )}
            placeholder="*/15 * * * *"
          />
          {!validation.valid && validation.error !== undefined && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {validation.error}
            </p>
          )}
        </div>
      )}

      {/* Toggle advanced / preset */}
      <button
        onClick={() => {
          if (entry.advancedMode) {
            // Try to parse back to preset
            const preset = cronToPreset(entry.schedule);
            onUpdate({ advancedMode: false, preset: preset ?? { frequency: 'hourly', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1 } });
          } else {
            onUpdate({ advancedMode: true });
          }
        }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {entry.advancedMode ? (
          <>
            <ChevronUp className="h-3 w-3" />
            Use preset
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" />
            Advanced (raw cron)
          </>
        )}
      </button>

      {/* Description + next runs */}
      {validation.valid && (
        <div className="rounded-md bg-muted/50 px-3 py-2.5 space-y-1.5">
          <p className="text-sm font-medium">{formatCron(entry.schedule)}</p>
          {nextRuns.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground font-medium">Next 5 runs (UTC)</p>
              {nextRuns.map((date, i) => (
                <p key={i} className="text-xs text-muted-foreground font-mono">
                  {date.toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ' UTC')}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
