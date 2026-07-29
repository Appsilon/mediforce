'use client';

import * as React from 'react';
import { Clock, Play, Square, Trash2, Pencil, Plus, Check, X, MousePointerClick, Webhook, Download, Upload } from 'lucide-react';
import { mediforce, ApiError } from '@/lib/mediforce';
import { saveBlobToDevice } from '@/lib/save-blob';
import { TriggerConfigFileSchema, type TriggerInputField } from '@mediforce/platform-core';
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

/** A placeholder value for each `triggerInput` type, so the generated example
 *  body is valid against the contract rather than merely well-shaped. */
function exampleValueFor(field: TriggerInputField): unknown {
  switch (field.type) {
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'date':
    case 'datetime':
      return new Date().toISOString();
    case 'select':
      return field.options?.[0] ?? 'option';
    case 'multiselect':
      return field.options?.slice(0, 1) ?? ['option'];
    case 'object':
      return {};
    default:
      return `<${field.name}>`;
  }
}

/** The exact body this webhook accepts, built from the workflow's `triggerInput`.
 *  Under ADR-0012 the body's top-level keys *are* the declared fields, so the
 *  example is derivable rather than guessed — which is what closes the old
 *  "what should the body be?" question the generic placeholder left open. */
function exampleBodyFor(triggerInput: TriggerInputField[]): string {
  const body = Object.fromEntries(
    triggerInput.map((field) => [field.name, exampleValueFor(field)]),
  );
  return JSON.stringify(body);
}

/** A ready-to-run curl example so callers know exactly how to fire the webhook —
 *  includes the auth header the endpoint requires and a body matching the
 *  workflow's declared input, so it works as-is once the API key is filled in. */
function WebhookUsageExample({
  url,
  triggerInput,
  contractLoading,
}: {
  url: string;
  triggerInput: TriggerInputField[];
  contractLoading: boolean;
}) {
  const origin = useOrigin();
  const command = [
    `curl -X ${WEBHOOK_METHOD} ${origin}${url} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-Api-Key: <your-api-key>' \\`,
    `  -d '${exampleBodyFor(triggerInput)}'`,
  ].join('\n');
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Example usage</p>
      <pre className="overflow-x-auto whitespace-pre rounded bg-muted px-3 py-2 font-mono text-xs">
        {command}
      </pre>
      {contractLoading ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Loading this workflow&rsquo;s input contract&hellip;
        </p>
      ) : triggerInput.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          This workflow declares no trigger input, so the body must be empty — a
          request carrying any field is rejected with 400. Declare fields under{' '}
          <code className="font-mono">triggerInput</code> in the workflow
          definition to accept input here.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          The body&rsquo;s top-level keys are this workflow&rsquo;s{' '}
          <code className="font-mono">triggerInput</code> fields, and steps read
          them as <code className="font-mono">{'${triggerPayload.<field>}'}</code>.
          A body with a missing, mistyped, or undeclared field is rejected with
          400. HTTP headers and query params are not input — they are available
          separately as{' '}
          <code className="font-mono">{'${triggerContext.*}'}</code>.
        </p>
      )}
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

/** A cron tick has no caller, so the input it hands the Run is edited here, per
 *  row (ADR-0012) — that is what lets two schedules on one workflow fire
 *  different constants. The server validates against `triggerInput`; this only
 *  catches "that isn't JSON" so the user isn't round-tripping for a typo.
 *
 *  Rendered as raw JSON rather than a generated per-field form: the same editor
 *  has to express an `object`-typed field's arbitrary nesting, which no flat
 *  form covers, and a cron payload is authored once and rarely touched. */
function CronPayloadEditor({
  value,
  onChange,
  triggerInput,
  contractLoading,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  triggerInput: TriggerInputField[];
  contractLoading: boolean;
  disabled: boolean;
}) {
  const malformed = value.trim().length > 0 && parseJsonObject(value) === null;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">Payload</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={triggerInput.length > 0 ? 3 : 2}
        placeholder={contractLoading ? '' : exampleBodyFor(triggerInput)}
        className={cn(
          'w-full rounded-md border bg-background px-3 py-1.5 font-mono text-sm outline-none',
          'focus:ring-1 focus:ring-ring focus:border-ring',
          malformed && 'border-destructive',
        )}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {contractLoading
          ? "Loading this workflow's input contract…"
          : triggerInput.length === 0
            ? 'This workflow declares no triggerInput, so leave this empty.'
            : `JSON object matching this workflow's triggerInput: ${triggerInput
                .map(
                  (field) =>
                    `${field.name}: ${field.type ?? 'string'}${field.required === true ? ' (required)' : ''}`,
                )
                .join(', ')}.`}
      </p>
      {malformed && <p className="mt-1 text-xs text-destructive">Not valid JSON.</p>}
    </div>
  );
}

/** Parse an editor value into the payload to send. Empty text means "no
 *  payload"; anything that isn't a JSON object is `null` so the caller can block
 *  submit rather than post something the server will only reject. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Render a stored payload back into editor text. An absent or empty payload
 *  shows as an empty box, not `{}`, so "no input" reads as nothing to fill in. */
function payloadToText(payload: Record<string, unknown> | undefined): string {
  if (payload === undefined || Object.keys(payload).length === 0) return '';
  return JSON.stringify(payload, null, 2);
}

export function TriggersPanel({
  handle,
  definitionName,
  triggerInput,
  contractLoading,
}: {
  handle: string;
  definitionName: string;
  /** The input contract of the version a firing resolves (ADR-0012). Every
   *  trigger on this panel validates against it, so it drives both the webhook's
   *  example body and the cron rows' static payload editor. */
  triggerInput: TriggerInputField[];
  /** True until that definition has loaded. An unloaded contract is
   *  indistinguishable from an empty one, and the empty-contract copy tells the
   *  user their body must be empty — advice the server would then reject. */
  contractLoading: boolean;
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

      <PortTriggersToolbar handle={handle} definitionName={definitionName} onImported={invalidate} />

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
                triggerInput={triggerInput}
                contractLoading={contractLoading}
                onChanged={invalidate}
              />
            ))}
          </ul>
        )}
        <AddCronTriggerForm
          handle={handle}
          definitionName={definitionName}
          triggerInput={triggerInput}
          contractLoading={contractLoading}
          onCreated={invalidate}
        />
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
            triggerInput={triggerInput}
            contractLoading={contractLoading}
            onChanged={invalidate}
          />
        ) : (
          <AddWebhookTriggerForm
            handle={handle}
            definitionName={definitionName}
            triggerInput={triggerInput}
            contractLoading={contractLoading}
            onCreated={invalidate}
          />
        )}
      </section>
    </div>
  );
}

/**
 * Export/import of the portable trigger-config file (Issue #933). Export
 * downloads the workflow's triggers as instance-free JSON; import reads a file,
 * validates it against the shared schema, and materializes rows in this
 * namespace — webhook URLs re-derive for this host, cron cursors anchor to now.
 * Import is seed-if-absent by default; the checkbox opts into overwriting names
 * that already exist.
 */
function PortTriggersToolbar({
  handle,
  definitionName,
  onImported,
}: {
  handle: string;
  definitionName: string;
  onImported: () => Promise<void>;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [replace, setReplace] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const [status, setStatus] = React.useState<string>('');

  async function exportTriggers() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const { triggers } = await mediforce.triggers.export({ definitionName, namespace: handle });
      const blob = new Blob([`${JSON.stringify(triggers, null, 2)}\n`], {
        type: 'application/json',
      });
      saveBlobToDevice(blob, `${definitionName}.triggers.json`);
      setStatus(`Exported ${String(triggers.length)} trigger(s).`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function importFromFile(file: File) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const parsed = TriggerConfigFileSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        setError('That file is not a valid trigger-config file.');
        return;
      }
      const { results } = await mediforce.triggers.import({
        definitionName,
        namespace: handle,
        triggers: parsed.data,
        replace,
      });
      const counts = { created: 0, replaced: 0, skipped: 0 };
      for (const r of results) counts[r.outcome] += 1;
      setStatus(
        `Imported: ${String(counts.created)} created, ${String(counts.replaced)} replaced, ${String(counts.skipped)} skipped.`,
      );
      await onImported();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFromFile(file);
        }}
      />
      <button
        onClick={() => void exportTriggers()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="h-4 w-4" />
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Upload className="h-4 w-4" />
        Import
      </button>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
          disabled={busy}
        />
        Overwrite existing on import
      </label>
      {status && <span className="text-xs text-muted-foreground">{status}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
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
  triggerInput,
  contractLoading,
  onChanged,
}: {
  handle: string;
  definitionName: string;
  trigger: WebhookTrigger;
  triggerInput: TriggerInputField[];
  contractLoading: boolean;
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

      <WebhookUsageExample url={url} triggerInput={triggerInput} contractLoading={contractLoading} />

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AddWebhookTriggerForm({
  handle,
  definitionName,
  triggerInput,
  contractLoading,
  onCreated,
}: {
  handle: string;
  definitionName: string;
  triggerInput: TriggerInputField[];
  contractLoading: boolean;
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
      <WebhookUsageExample
        url={previewUrl}
        triggerInput={triggerInput}
        contractLoading={contractLoading}
      />
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
  triggerInput,
  contractLoading,
  onChanged,
}: {
  handle: string;
  definitionName: string;
  trigger: CronTrigger;
  triggerInput: TriggerInputField[];
  contractLoading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [scheduleDraft, setScheduleDraft] = React.useState(trigger.config.schedule);
  const [payloadDraft, setPayloadDraft] = React.useState(payloadToText(trigger.config.payload));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');

  const draftPayload = parseJsonObject(payloadDraft);
  // Only send `payload` when the user actually edited it. Resending an
  // unchanged one re-runs attach-time validation, so a row whose payload has
  // drifted behind a newer contract — which ADR-0012 says should skip at fire
  // time, not block edits — could not even be retimed. It also keeps the
  // `cron.trigger.updated` audit entry honest about what changed.
  const payloadEdited = payloadDraft !== payloadToText(trigger.config.payload);

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
              <CronPayloadEditor
                value={payloadDraft}
                onChange={setPayloadDraft}
                triggerInput={triggerInput}
                contractLoading={contractLoading}
                disabled={busy}
              />
            </div>
          ) : (
            <div className="mt-1 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>{formatCron(trigger.config.schedule)}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {trigger.config.schedule}
                </span>
              </div>
              {payloadToText(trigger.config.payload).length > 0 && (
                <pre className="overflow-x-auto whitespace-pre rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {JSON.stringify(trigger.config.payload)}
                </pre>
              )}
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
                      ...(payloadEdited && draftPayload !== null
                        ? { payload: draftPayload }
                        : {}),
                    })
                    .then(() => setEditing(false)),
                )
              }
              disabled={busy || scheduleDraft.trim().length === 0 || draftPayload === null}
              title="Save schedule and payload"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setScheduleDraft(trigger.config.schedule);
                setPayloadDraft(payloadToText(trigger.config.payload));
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
                setPayloadDraft(payloadToText(trigger.config.payload));
                setError('');
                setEditing(true);
              }}
              disabled={busy}
              title="Edit schedule and payload"
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
  triggerInput,
  contractLoading,
  onCreated,
}: {
  handle: string;
  definitionName: string;
  triggerInput: TriggerInputField[];
  contractLoading: boolean;
  onCreated: () => Promise<void>;
}) {
  const [triggerName, setTriggerName] = React.useState('');
  const [schedule, setSchedule] = React.useState('');
  const [payload, setPayload] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>('');

  const parsedPayload = parseJsonObject(payload);
  const canSubmit =
    triggerName.trim().length > 0 &&
    schedule.trim().length > 0 &&
    parsedPayload !== null &&
    !busy;

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
        ...(parsedPayload === null || Object.keys(parsedPayload).length === 0
          ? {}
          : { payload: parsedPayload }),
        enabled: true,
      });
      setTriggerName('');
      setSchedule('');
      setPayload('');
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
      <div className="mt-3">
        <CronPayloadEditor
          value={payload}
          onChange={setPayload}
          triggerInput={triggerInput}
          contractLoading={contractLoading}
          disabled={busy}
        />
      </div>
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
