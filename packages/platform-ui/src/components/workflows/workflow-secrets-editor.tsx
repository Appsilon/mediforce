'use client';

import * as React from 'react';
import { Eye, EyeOff, Plus, Trash2, Save, Info, ClipboardPaste } from 'lucide-react';
import { getWorkflowSecrets, saveWorkflowSecrets } from '@/app/actions/workflow-secrets';

/** Parse .env-style text into key-value pairs. Handles KEY=VALUE, KEY="VALUE", KEY='VALUE', comments, blank lines. */
function parseEnvText(text: string): Array<{ key: string; value: string }> | null {
  const lines = text.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
  if (lines.length === 0) return null;

  const parsed: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
    if (!match) return null; // not env format — abort
    const key = match[1];
    let value = match[2].trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed.push({ key, value });
  }
  return parsed.length > 0 ? parsed : null;
}

interface WorkflowSecretsEditorProps {
  namespace: string;
  workflowName: string;
  userId: string;
}

export function WorkflowSecretsEditor({ namespace, workflowName, userId }: WorkflowSecretsEditorProps) {
  const [secrets, setSecrets] = React.useState<Array<{ key: string; value: string }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [revealedIndices, setRevealedIndices] = React.useState<Set<number>>(new Set());
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [bulkMode, setBulkMode] = React.useState(false);
  const [bulkText, setBulkText] = React.useState('');
  const [bulkPreview, setBulkPreview] = React.useState<Array<{ key: string; value: string }> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWorkflowSecrets(namespace, workflowName, userId).then((data) => {
      if (cancelled) return;
      const entries = Object.entries(data).map(([key, value]) => ({ key, value }));
      setSecrets(entries);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [namespace, workflowName, userId]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    const record: Record<string, string> = {};
    for (const { key, value } of secrets) {
      const trimmedKey = key.trim();
      if (trimmedKey !== '') {
        record[trimmedKey] = value;
      }
    }
    await saveWorkflowSecrets(namespace, workflowName, record, userId);
    setDirty(false);
    setSaving(false);
    setSaveMessage('Secrets saved');
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const addRow = () => {
    setSecrets((prev) => [...prev, { key: '', value: '' }]);
    setDirty(true);
  };

  const removeRow = (index: number) => {
    setSecrets((prev) => prev.filter((_, idx) => idx !== index));
    setDirty(true);
  };

  const updateRow = (index: number, field: 'key' | 'value', newValue: string) => {
    setSecrets((prev) => prev.map((row, idx) => (idx === index ? { ...row, [field]: newValue } : row)));
    setDirty(true);
  };

  const toggleReveal = (index: number) => {
    setRevealedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
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
          Secrets defined here are available in workflow step env vars using{' '}
          <code className="rounded bg-blue-100 dark:bg-blue-900/50 px-1 py-0.5 font-mono text-xs">{'{{KEY}}'}</code>{' '}
          syntax. They persist across definition versions.
        </span>
      </div>

      {secrets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No secrets configured yet.</p>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_72px] gap-2 text-xs font-medium text-muted-foreground px-1">
            <span>Key</span>
            <span>Value</span>
            <span />
          </div>
          {secrets.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_72px] gap-2 items-center">
              <input
                type="text"
                value={row.key}
                onChange={(event) => updateRow(index, 'key', event.target.value)}
                placeholder="SECRET_NAME"
                className="h-9 rounded-md border bg-background px-3 text-sm font-mono"
              />
              <div className="relative">
                <input
                  type={revealedIndices.has(index) ? 'text' : 'password'}
                  value={row.value}
                  onChange={(event) => updateRow(index, 'value', event.target.value)}
                  placeholder="secret value"
                  className="h-9 w-full rounded-md border bg-background px-3 pr-9 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => toggleReveal(index)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {revealedIndices.has(index) ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
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
            placeholder={'VIKING_LOGIN=user@example.com\nVIKING_PASSWORD=s3cret'}
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
                const existingKeys = new Set(secrets.map((s) => s.key));
                const merged = [...secrets];
                for (const entry of bulkPreview) {
                  const idx = merged.findIndex((s) => s.key === entry.key);
                  if (idx >= 0) {
                    merged[idx] = entry; // overwrite existing
                  } else {
                    merged.push(entry);
                  }
                }
                setSecrets(merged);
                setDirty(true);
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
          <span className="text-sm text-green-600 dark:text-green-400">{saveMessage}</span>
        )}
      </div>
    </div>
  );
}
