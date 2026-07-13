'use client';

import * as React from 'react';
import { Clock, Play, Square, Trash2, Pencil, Plus, Check, X } from 'lucide-react';
import { mediforce, ApiError } from '@/lib/mediforce';
import { formatCron } from '@/lib/format-cron';
import { cn } from '@/lib/utils';

type CronTrigger = Awaited<
  ReturnType<typeof mediforce.cronTriggers.list>
>['triggers'][number];

const SCHEDULE_HELPER_TEXT =
  '5-field cron, UTC. Minutes must be :00, :15, :30 or :45 (aligned to the 15-minute heartbeat).';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export function CronTriggersPanel({
  handle,
  definitionName,
}: {
  handle: string;
  definitionName: string;
}) {
  const [triggers, setTriggers] = React.useState<CronTrigger[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string>('');

  const refetch = React.useCallback(async () => {
    setLoadError('');
    try {
      const { triggers: rows } = await mediforce.cronTriggers.list({
        definitionName,
        namespace: handle,
      });
      setTriggers(rows);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [definitionName, handle]);

  React.useEffect(() => {
    setLoading(true);
    void refetch();
  }, [refetch]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-16 rounded-md bg-muted" />
        <div className="h-16 rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <p className="text-sm text-destructive">{loadError}</p>
      )}

      {triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cron triggers yet. Add one below to run this workflow on a schedule.
        </p>
      ) : (
        <ul className="space-y-3">
          {triggers.map((trigger) => (
            <CronTriggerRow
              key={trigger.triggerName}
              handle={handle}
              definitionName={definitionName}
              trigger={trigger}
              onChanged={refetch}
            />
          ))}
        </ul>
      )}

      <AddCronTriggerForm
        handle={handle}
        definitionName={definitionName}
        onCreated={refetch}
      />
    </div>
  );
}

function CronTriggerRow({
  handle,
  definitionName,
  trigger,
  onChanged,
}: {
  handle: string;
  definitionName: string;
  trigger: CronTrigger;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [scheduleDraft, setScheduleDraft] = React.useState(trigger.schedule);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');

  const isEnabled = trigger.enabled === true;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={cn(
        'rounded-md border p-4',
        isEnabled ? 'bg-background' : 'bg-muted/40 border-dashed',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clock
              className={cn(
                'h-4 w-4 shrink-0',
                isEnabled ? 'text-foreground' : 'text-muted-foreground',
              )}
            />
            <span className="font-medium truncate">{trigger.triggerName}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                isEnabled
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {isEnabled ? 'Running' : 'Stopped'}
            </span>
          </div>

          {editing ? (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={scheduleDraft}
                onChange={(e) => setScheduleDraft(e.target.value)}
                disabled={busy}
                className={cn(
                  'w-full max-w-xs rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none',
                  'focus:ring-1 focus:ring-ring focus:border-ring',
                  error && 'border-destructive',
                )}
              />
              <p className="text-xs text-muted-foreground">{SCHEDULE_HELPER_TEXT}</p>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{formatCron(trigger.schedule)}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {trigger.schedule}
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <>
              <button
                onClick={() =>
                  run(() =>
                    mediforce.cronTriggers
                      .update({
                        definitionName,
                        namespace: handle,
                        triggerName: trigger.triggerName,
                        schedule: scheduleDraft.trim(),
                      })
                      .then(() => setEditing(false)),
                  )
                }
                disabled={busy || scheduleDraft.trim().length === 0}
                title="Save schedule"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setScheduleDraft(trigger.schedule);
                  setError('');
                  setEditing(false);
                }}
                disabled={busy}
                title="Cancel"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() =>
                  run(() =>
                    mediforce.cronTriggers.setEnabled({
                      definitionName,
                      namespace: handle,
                      triggerName: trigger.triggerName,
                      enabled: !isEnabled,
                    }),
                  )
                }
                disabled={busy}
                title={isEnabled ? 'Stop' : 'Start'}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              >
                {isEnabled ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => {
                  setScheduleDraft(trigger.schedule);
                  setError('');
                  setEditing(true);
                }}
                disabled={busy}
                title="Edit schedule"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete cron trigger "${trigger.triggerName}"? This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  void run(() =>
                    mediforce.cronTriggers.delete({
                      definitionName,
                      namespace: handle,
                      triggerName: trigger.triggerName,
                    }),
                  );
                }}
                disabled={busy}
                title="Delete"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </li>
  );
}

function AddCronTriggerForm({
  handle,
  definitionName,
  onCreated,
}: {
  handle: string;
  definitionName: string;
  onCreated: () => Promise<void>;
}) {
  const [triggerName, setTriggerName] = React.useState('');
  const [schedule, setSchedule] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');

  const canSubmit =
    triggerName.trim().length > 0 && schedule.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await mediforce.cronTriggers.create({
        definitionName,
        namespace: handle,
        triggerName: triggerName.trim(),
        schedule: schedule.trim(),
        enabled: true,
      });
      setTriggerName('');
      setSchedule('');
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('a trigger with that name already exists');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Plus className="h-4 w-4" />
        Add cron trigger
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input
            type="text"
            value={triggerName}
            onChange={(e) => setTriggerName(e.target.value)}
            disabled={busy}
            placeholder="nightly-refresh"
            className={cn(
              'w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none',
              'focus:ring-1 focus:ring-ring focus:border-ring',
            )}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Schedule</label>
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            disabled={busy}
            placeholder="0 6 * * *"
            className={cn(
              'w-full rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none',
              'focus:ring-1 focus:ring-ring focus:border-ring',
              error && 'border-destructive',
            )}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{SCHEDULE_HELPER_TEXT}</p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {busy ? 'Adding...' : 'Add trigger'}
        </button>
      </div>
    </div>
  );
}
