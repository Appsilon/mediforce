'use client';

import * as React from 'react';
import { Clock, Play, Square, Trash2, Pencil, Plus, Check, X, MousePointerClick, Webhook } from 'lucide-react';
import { mediforce, ApiError } from '@/lib/mediforce';
import {
  useWorkflowTriggers,
  type CronTrigger,
  type ManualTrigger,
  type WebhookTrigger,
} from '@/hooks/use-workflow-triggers';
import { formatCron } from '@/lib/format-cron';
import { cn } from '@/lib/utils';

const SCHEDULE_HELPER_TEXT =
  '5-field cron, UTC. Minutes must be :00, :15, :30 or :45 (aligned to the 15-minute heartbeat).';

const WEBHOOK_PATH_HELPER_TEXT =
  'Leading slash, url-safe chars only (e.g. /orders). The full URL is built from your handle and workflow name — you only choose the path.';

/** Canonical name of the per-workflow manual trigger singleton (Issue #930). */
const MANUAL_TRIGGER_NAME = 'manual';

/** Canonical name of the per-workflow webhook trigger singleton (Issue #931).
 *  One webhook per workflow is enforced in the handler; the UI names the one it
 *  creates canonically. Seeded webhooks keep their declared name. */
const WEBHOOK_TRIGGER_NAME = 'webhook';

/** Webhooks are reachable only as POST — the catch-all route exports just
 *  `POST`, so a webhook created with any other verb would 405 before routing.
 *  New webhooks are always created as POST; there is no method to choose. */
const WEBHOOK_METHOD = 'POST';

/** The fixed prefix every webhook URL for this workflow starts with — the caller
 *  only appends their chosen `path`. Mirrors the handler's `webhookUrlFor`. */
function webhookPrefixOf(handle: string, definitionName: string): string {
  return `/api/triggers/webhook/${handle}/${definitionName}`;
}

/** The relative endpoint a webhook trigger listens on — mirrors the handler's
 *  `webhookUrlFor`. `path` already carries its leading slash. */
function webhookUrlOf(handle: string, definitionName: string, path: string): string {
  return `${webhookPrefixOf(handle, definitionName)}${path}`;
}

/** Absolute origin for copy-pasteable usage examples; empty during SSR. */
function useOrigin(): string {
  const [origin, setOrigin] = React.useState('');
  React.useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  return origin;
}

/** A ready-to-run curl example so callers know exactly how to fire the webhook —
 *  includes the auth header the endpoint requires and a JSON body, so it works
 *  as-is once the API key is filled in. */
function WebhookUsageExample({ url }: { url: string }) {
  const origin = useOrigin();
  const command = [
    `curl -X ${WEBHOOK_METHOD} ${origin}${url} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-Api-Key: <your-api-key>' \\`,
    `  -d '{"order": 42}'`,
  ].join('\n');
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Example usage</p>
      <pre className="overflow-x-auto whitespace-pre rounded bg-muted px-3 py-2 font-mono text-xs">
        {command}
      </pre>
      <p className="mt-1 text-xs text-muted-foreground">
        The JSON body is passed to the workflow as{' '}
        <code className="font-mono">triggerPayload.body</code> — its shape is up to
        this workflow; check what its steps read from{' '}
        <code className="font-mono">triggerPayload.body</code>.
      </p>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export function TriggersPanel({
  handle,
  definitionName,
}: {
  handle: string;
  definitionName: string;
}) {
  const { cronTriggers, manualTriggers, webhookTriggers, loading, error, invalidate } =
    useWorkflowTriggers(definitionName, handle);
  const loadError = error !== null ? errorMessage(error) : '';

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-16 rounded-md bg-muted" />
        <div className="h-16 rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Manual</h2>
          <p className="text-xs text-muted-foreground">
            The manual trigger makes this workflow hand-startable. It is always
            present — start or stop it to allow or block the Start Run button and
            API starts; it can&rsquo;t be removed.
          </p>
        </div>
        <ManualTriggerRow
          handle={handle}
          definitionName={definitionName}
          trigger={manualTriggers[0] ?? null}
          onChanged={invalidate}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Scheduled (cron)</h2>
          <p className="text-xs text-muted-foreground">
            Fire this workflow automatically on a schedule.
          </p>
        </div>
        {cronTriggers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cron triggers yet. Add one below to run this workflow on a schedule.
          </p>
        ) : (
          <ul className="space-y-3">
            {cronTriggers.map((trigger) => (
              <CronTriggerRow
                key={trigger.name}
                handle={handle}
                definitionName={definitionName}
                trigger={trigger}
                onChanged={invalidate}
              />
            ))}
          </ul>
        )}
        <AddCronTriggerForm handle={handle} definitionName={definitionName} onCreated={invalidate} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Webhook</h2>
          <p className="text-xs text-muted-foreground">
            Expose an HTTP endpoint that starts this workflow. One webhook per
            workflow — remove it to take the endpoint offline.
          </p>
        </div>
        {webhookTriggers[0] ? (
          <WebhookTriggerRow
            handle={handle}
            definitionName={definitionName}
            trigger={webhookTriggers[0]}
            onChanged={invalidate}
          />
        ) : (
          <AddWebhookTriggerForm
            handle={handle}
            definitionName={definitionName}
            onCreated={invalidate}
          />
        )}
      </section>
    </div>
  );
}

/** Start/stop + delete controls shared by manual and cron rows. */
function RowActions({
  isEnabled,
  busy,
  onToggle,
  onDelete,
  children,
}: {
  isEnabled: boolean;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {children}
      <button
        onClick={onToggle}
        disabled={busy}
        title={isEnabled ? 'Stop' : 'Start'}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
      >
        {isEnabled ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        title="Delete"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function StatusBadge({ isEnabled }: { isEnabled: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        isEnabled ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground',
      )}
    >
      {isEnabled ? 'Running' : 'Stopped'}
    </span>
  );
}

/**
 * The manual trigger is a per-workflow singleton (Issue #930): always shown as
 * "Manual", start/stop only, never removable. When the row doesn't exist yet
 * (legacy workflow), Start creates the canonical `manual` row enabled.
 */
function ManualTriggerRow({
  handle,
  definitionName,
  trigger,
  onChanged,
}: {
  handle: string;
  definitionName: string;
  trigger: ManualTrigger | null;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const isEnabled = trigger?.enabled === true;

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

  function toggle() {
    if (trigger === null) {
      // No row yet — Start creates the canonical singleton, enabled.
      void run(() =>
        mediforce.triggers.create({
          definitionName,
          namespace: handle,
          triggerName: MANUAL_TRIGGER_NAME,
          type: 'manual',
          enabled: true,
        }),
      );
      return;
    }
    void run(() =>
      mediforce.triggers.setEnabled({
        definitionName,
        namespace: handle,
        triggerName: trigger.name,
        enabled: !isEnabled,
      }),
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border p-4',
        isEnabled ? 'bg-background' : 'bg-muted/40 border-dashed',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MousePointerClick
              className={cn(
                'h-4 w-4 shrink-0',
                isEnabled ? 'text-foreground' : 'text-muted-foreground',
              )}
            />
            <span className="font-medium truncate">Manual</span>
            <StatusBadge isEnabled={isEnabled} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Hand-started by a person or the API.</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={toggle}
            disabled={busy}
            title={isEnabled ? 'Stop' : 'Start'}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
          >
            {isEnabled ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The webhook trigger is a per-workflow singleton (Issue #931): shows the live
 * endpoint URL, start/stop, and remove. Resolution is table-backed, so stopping
 * takes the endpoint offline immediately without cutting a new definition.
 */
function WebhookTriggerRow({
  handle,
  definitionName,
  trigger,
  onChanged,
}: {
  handle: string;
  definitionName: string;
  trigger: WebhookTrigger;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const isEnabled = trigger.enabled === true;
  const url = webhookUrlOf(handle, definitionName, trigger.config.path);

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
    <div
      className={cn(
        'rounded-md border p-4',
        isEnabled ? 'bg-background' : 'bg-muted/40 border-dashed',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Webhook
              className={cn(
                'h-4 w-4 shrink-0',
                isEnabled ? 'text-foreground' : 'text-muted-foreground',
              )}
            />
            <span className="font-medium truncate">{trigger.name}</span>
            <StatusBadge isEnabled={isEnabled} />
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {trigger.config.method}
            </span>
            <span className="truncate font-mono text-xs">{url}</span>
          </div>
        </div>

        <RowActions
          isEnabled={isEnabled}
          busy={busy}
          onToggle={() =>
            run(() =>
              mediforce.triggers.setEnabled({
                definitionName,
                namespace: handle,
                triggerName: trigger.name,
                enabled: !isEnabled,
              }),
            )
          }
          onDelete={() => {
            if (!window.confirm(`Remove the webhook trigger "${trigger.name}"? Its URL will stop working.`)) {
              return;
            }
            void run(() =>
              mediforce.triggers.delete({
                definitionName,
                namespace: handle,
                triggerName: trigger.name,
              }),
            );
          }}
        />
      </div>

      <WebhookUsageExample url={url} />

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AddWebhookTriggerForm({
  handle,
  definitionName,
  onCreated,
}: {
  handle: string;
  definitionName: string;
  onCreated: () => Promise<void>;
}) {
  const [path, setPath] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');

  const previewUrl = webhookUrlOf(handle, definitionName, path.trim() || '/path');
  const canSubmit = path.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await mediforce.triggers.create({
        definitionName,
        namespace: handle,
        triggerName: WEBHOOK_TRIGGER_NAME,
        type: 'webhook',
        method: WEBHOOK_METHOD,
        path: path.trim(),
        enabled: true,
      });
      setPath('');
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('this workflow already has a webhook trigger');
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
        Create webhook trigger
      </h3>
      <div className="mt-3">
        <label className="mb-1 block text-sm font-medium">Path</label>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={busy}
          placeholder="/orders"
          className={cn(
            'w-full rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none',
            'focus:ring-1 focus:ring-ring focus:border-ring',
            error && 'border-destructive',
          )}
        />
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          Full URL: <span className="text-foreground">{previewUrl}</span>
        </p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{WEBHOOK_PATH_HELPER_TEXT}</p>
      <WebhookUsageExample url={previewUrl} />
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
          {busy ? 'Creating...' : 'Create webhook trigger'}
        </button>
      </div>
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
  const [scheduleDraft, setScheduleDraft] = React.useState(trigger.config.schedule);
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
            <span className="font-medium truncate">{trigger.name}</span>
            <StatusBadge isEnabled={isEnabled} />
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
              <span>{formatCron(trigger.config.schedule)}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {trigger.config.schedule}
              </span>
            </div>
          )}
        </div>

        {editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() =>
                run(() =>
                  mediforce.triggers
                    .update({
                      definitionName,
                      namespace: handle,
                      triggerName: trigger.name,
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
                setScheduleDraft(trigger.config.schedule);
                setError('');
                setEditing(false);
              }}
              disabled={busy}
              title="Cancel"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <RowActions
            isEnabled={isEnabled}
            busy={busy}
            onToggle={() =>
              run(() =>
                mediforce.triggers.setEnabled({
                  definitionName,
                  namespace: handle,
                  triggerName: trigger.name,
                  enabled: !isEnabled,
                }),
              )
            }
            onDelete={() => {
              if (!window.confirm(`Delete trigger "${trigger.name}"? This cannot be undone.`)) {
                return;
              }
              void run(() =>
                mediforce.triggers.delete({
                  definitionName,
                  namespace: handle,
                  triggerName: trigger.name,
                }),
              );
            }}
          >
            <button
              onClick={() => {
                setScheduleDraft(trigger.config.schedule);
                setError('');
                setEditing(true);
              }}
              disabled={busy}
              title="Edit schedule"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </RowActions>
        )}
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

  const canSubmit = triggerName.trim().length > 0 && schedule.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await mediforce.triggers.create({
        definitionName,
        namespace: handle,
        triggerName: triggerName.trim(),
        type: 'cron',
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
          {busy ? 'Adding...' : 'Add cron trigger'}
        </button>
      </div>
    </div>
  );
}
