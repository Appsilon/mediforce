'use client';

import * as React from 'react';
import { Plus, Trash2, Save, Info, ClipboardPaste } from 'lucide-react';
import {
  getNamespaceSecretPreviews,
  upsertNamespaceSecret,
  deleteNamespaceSecret,
  type SecretPreview,
} from '@/app/actions/namespace-secrets';

function parseEnvText(text: string): Array<{ key: string; value: string }> | null {
  const lines = text.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
  if (lines.length === 0) return null;

  const parsed: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
    if (!match) return null;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed.push({ key, value });
  }
  return parsed.length > 0 ? parsed : null;
}

interface Row {
  key: string;
  value: string;
  preview?: string;
  isNew: boolean;
  changed: boolean;
}

interface NamespaceSecretsEditorProps {
  namespace: string;
  userId: string;
}

export function NamespaceSecretsEditor({ namespace, userId }: NamespaceSecretsEditorProps) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [deletedKeys, setDeletedKeys] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [bulkMode, setBulkMode] = React.useState(false);
  const [bulkText, setBulkText] = React.useState('');
  const [bulkPreview, setBulkPreview] = React.useState<Array<{ key: string; value: string }> | null>(null);

  const dirty = rows.some((r) => r.changed || r.isNew) || deletedKeys.length > 0;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getNamespaceSecretPreviews(namespace, userId)
      .then((previews) => {
        if (cancelled) return;
        setRows(previews.map((p) => ({
          key: p.key,
          value: '',
          preview: p.preview,
          isNew: false,
          changed: false,
        })));
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load namespace secrets:', error);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [namespace, userId]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const ops: Promise<void>[] = [];
      for (const row of rows) {
        if ((row.changed || row.isNew) && row.key.trim() !== '' && row.value !== '') {
          ops.push(upsertNamespaceSecret(namespace, row.key.trim(), row.value, userId));
        }
      }
      for (const key of deletedKeys) {
        ops.push(deleteNamespaceSecret(namespace, key, userId));
      }
      await Promise.all(ops);

      setRows((prev) => prev
        .filter((r) => r.key.trim() !== '' && (r.value !== '' || !r.isNew))
        .map((r) => ({
          ...r,
          preview: r.changed || r.isNew ? maskLocally(r.value) : r.preview,
          value: '',
          isNew: false,
          changed: false,
        })),
      );
      setDeletedKeys([]);
      setSaveMessage('Secrets saved');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setSaveMessage(`Error: ${message}`);
      console.error('Failed to save namespace secrets:', error);
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, { key: '', value: '', isNew: true, changed: false }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => {
      const row = prev[index];
      if (row && !row.isNew && row.key.trim() !== '') {
        setDeletedKeys((dk) => [...dk, row.key]);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const updateRow = (index: number, field: 'key' | 'value', newValue: string) => {
    setRows((prev) => prev.map((row, idx) => {
      if (idx !== index) return row;
      const updated = { ...row, [field]: newValue };
      if (field === 'value' && newValue !== '') updated.changed = true;
      if (field === 'key' && row.isNew) updated.changed = true;
      return updated;
    }));
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-10 rounded bg-muted" />
        <div className="h-10 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3 text-sm text-blue-800 dark:text-blue-300">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Workspace secrets are shared across all workflows. Individual workflows can override
          them with workflow-level secrets. Use{' '}
          <code className="rounded bg-blue-100 dark:bg-blue-900/50 px-1 py-0.5 font-mono text-xs">{'{{KEY}}'}</code>{' '}
          syntax in step env vars. Secret values cannot be read back after saving.
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workspace secrets configured yet.</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_72px] gap-2 text-xs font-medium text-muted-foreground px-1">
            <span>Key</span>
            <span>Value</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_72px] gap-2 items-center">
              <input
                type="text"
                value={row.key}
                onChange={(event) => updateRow(index, 'key', event.target.value)}
                placeholder="SECRET_NAME"
                disabled={!row.isNew}
                className="h-9 rounded-md border bg-background px-3 text-sm font-mono disabled:opacity-70"
              />
              <input
                type="text"
                value={row.changed || row.isNew ? row.value : ''}
                onChange={(event) => updateRow(index, 'value', event.target.value)}
                placeholder={row.preview ?? 'secret value'}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="h-9 w-9 flex items-center justify-center rounded-md border text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {bulkMode ? (
        <div className="space-y-2 rounded-md border p-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Paste <code className="font-mono">.env</code> content — one <code className="font-mono">KEY=value</code> per line:
          </p>
          <textarea
            value={bulkText}
            onChange={(event) => {
              setBulkText(event.target.value);
              setBulkPreview(parseEnvText(event.target.value));
            }}
            placeholder={'OPENROUTER_API_KEY=sk-or-v1-...\nDEEPSEEK_API_KEY=sk-...'}
            rows={5}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono resize-y"
            autoFocus
          />
          {bulkPreview && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Detected {bulkPreview.length} variable{bulkPreview.length !== 1 ? 's' : ''}: {bulkPreview.map((p) => p.key).join(', ')}
            </p>
          )}
          {bulkText.trim() !== '' && !bulkPreview && (
            <p className="text-xs text-destructive">
              Could not parse — expected KEY=value format, one per line
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!bulkPreview}
              onClick={() => {
                if (!bulkPreview) return;
                setRows((prev) => {
                  const merged = [...prev];
                  for (const entry of bulkPreview) {
                    const idx = merged.findIndex((s) => s.key === entry.key);
                    if (idx >= 0) {
                      merged[idx] = { ...merged[idx], value: entry.value, changed: true };
                    } else {
                      merged.push({ key: entry.key, value: entry.value, isNew: true, changed: true });
                    }
                  }
                  return merged;
                });
                setBulkMode(false);
                setBulkText('');
                setBulkPreview(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Import {bulkPreview?.length ?? 0} variable{(bulkPreview?.length ?? 0) !== 1 ? 's' : ''}
            </button>
            <button
              type="button"
              onClick={() => { setBulkMode(false); setBulkText(''); setBulkPreview(null); }}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add secret
        </button>

        {!bulkMode && (
          <button
            type="button"
            onClick={() => setBulkMode(true)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Paste .env
          </button>
        )}

        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}

        {saveMessage && (
          <span className={`text-sm ${saveMessage.startsWith('Error:') ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>{saveMessage}</span>
        )}
      </div>
    </div>
  );
}

function maskLocally(value: string): string {
  if (value.length > 12) return `${value.slice(0, 4)}...${value.slice(-4)}`;
  return '•'.repeat(8);
}
