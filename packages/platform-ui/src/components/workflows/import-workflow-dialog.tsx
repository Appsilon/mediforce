'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, GitBranch, Loader2, Check, AlertCircle, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforce, ApiError } from '@/lib/mediforce';
import { githubRawBase, WorkflowManifestSchema } from '@mediforce/platform-core';
import type { WorkflowManifestEntry } from '@mediforce/platform-core';

interface ImportWorkflowDialogProps {
  namespace: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

type ImportResult =
  | { name: string; path: string; status: 'pending' }
  | { name: string; path: string; status: 'success' }
  | { name: string; path: string; status: 'error'; message: string };

type State =
  | { step: 'browsing'; error?: string }
  | { step: 'fetching' }
  | { step: 'selecting'; entries: WorkflowManifestEntry[] }
  | { step: 'importing'; results: ImportResult[] }
  | { step: 'done'; results: ImportResult[] };

const DEFAULT_REPO = 'https://github.com/Appsilon/mediforce-workflows';

export function ImportWorkflowDialog({
  namespace,
  open,
  onOpenChange,
  onImported,
}: ImportWorkflowDialogProps) {
  const [state, setState] = React.useState<State>({ step: 'browsing' });
  const [repoUrl, setRepoUrl] = React.useState(DEFAULT_REPO);
  const [ref, setRef] = React.useState('main');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) {
      setState({ step: 'browsing' });
      setRepoUrl(DEFAULT_REPO);
      setRef('main');
      setSelected(new Set());
    }
  }, [open]);

  const busy = state.step === 'fetching' || state.step === 'importing';

  function handleClose() {
    if (busy) return;
    onOpenChange(false);
  }

  async function handleBrowse() {
    const rawBase = githubRawBase(repoUrl.trim(), ref.trim());
    if (rawBase === null) {
      setState({ step: 'browsing', error: 'Only GitHub URLs are supported.' });
      return;
    }
    setState({ step: 'fetching' });
    try {
      const res = await fetch(`${rawBase}/index.json`);
      if (!res.ok) {
        setState({ step: 'browsing', error: `Failed to fetch manifest: HTTP ${String(res.status)}` });
        return;
      }
      const raw: unknown = await res.json();
      const parsed = WorkflowManifestSchema.safeParse(raw);
      if (!parsed.success) {
        setState({ step: 'browsing', error: 'Repository does not contain a valid index.json manifest.' });
        return;
      }
      setState({ step: 'selecting', entries: parsed.data.workflows });
    } catch (err) {
      setState({
        step: 'browsing',
        error: `Failed to fetch manifest: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  function toggleEntry(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll(entries: WorkflowManifestEntry[]) {
    setSelected((prev) =>
      prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.name)),
    );
  }

  async function handleImport(entries: WorkflowManifestEntry[]) {
    const toImport = entries.filter((e) => selected.has(e.name));
    const initial: ImportResult[] = toImport.map((e) => ({
      name: e.name,
      path: e.path,
      status: 'pending',
    }));
    setState({ step: 'importing', results: initial });

    const updated: ImportResult[] = [...initial];
    for (let i = 0; i < toImport.length; i++) {
      const entry = toImport[i]!;
      try {
        await mediforce.workflows.importFromRepo(
          { repo: repoUrl.trim(), path: entry.path, ref: ref.trim() },
          { namespace },
        );
        updated[i] = { name: entry.name, path: entry.path, status: 'success' };
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message
          : err instanceof Error ? err.message
          : 'Import failed';
        updated[i] = { name: entry.name, path: entry.path, status: 'error', message };
      }
      setState({ step: 'importing', results: [...updated] });
    }

    setState({ step: 'done', results: updated });
    if (updated.some((r) => r.status === 'success')) {
      onImported();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => { if (!value) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Import workflows from git
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors"
                disabled={busy}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {(state.step === 'browsing' || state.step === 'fetching') && (
            <BrowsingStep
              repoUrl={repoUrl}
              ref_={ref}
              error={state.step === 'browsing' ? state.error : undefined}
              loading={state.step === 'fetching'}
              onRepoUrlChange={setRepoUrl}
              onRefChange={setRef}
              onBrowse={handleBrowse}
              onCancel={handleClose}
            />
          )}

          {state.step === 'selecting' && (
            <SelectingStep
              entries={state.entries}
              selected={selected}
              onToggle={toggleEntry}
              onToggleAll={() => toggleAll(state.entries)}
              onBack={() => setState({ step: 'browsing' })}
              onImport={() => handleImport(state.entries)}
            />
          )}

          {(state.step === 'importing' || state.step === 'done') && (
            <ProgressStep
              results={state.results}
              done={state.step === 'done'}
              onClose={handleClose}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BrowsingStep({
  repoUrl,
  ref_,
  error,
  loading,
  onRepoUrlChange,
  onRefChange,
  onBrowse,
  onCancel,
}: {
  repoUrl: string;
  ref_: string;
  error?: string;
  loading: boolean;
  onRepoUrlChange: (v: string) => void;
  onRefChange: (v: string) => void;
  onBrowse: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <Dialog.Description className="text-sm text-muted-foreground">
        Enter a public GitHub repository URL that contains an{' '}
        <span className="font-mono bg-muted px-1 py-0.5 rounded text-xs">index.json</span> manifest.
      </Dialog.Description>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium" htmlFor="import-repo-url">
            Repository URL
          </label>
          <input
            id="import-repo-url"
            type="url"
            value={repoUrl}
            onChange={(e) => onRepoUrlChange(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            autoComplete="off"
            disabled={loading}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="import-ref">
            Branch / tag / commit
          </label>
          <input
            id="import-ref"
            type="text"
            value={ref_}
            onChange={(e) => onRefChange(e.target.value)}
            placeholder="main"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          disabled={loading}
          className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onBrowse}
          disabled={loading || !repoUrl.trim() || !ref_.trim()}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Browse
        </button>
      </div>
    </div>
  );
}

function SelectingStep({
  entries,
  selected,
  onToggle,
  onToggleAll,
  onBack,
  onImport,
}: {
  entries: WorkflowManifestEntry[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onToggleAll: () => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const allSelected = selected.size === entries.length && entries.length > 0;
  const importCount = selected.size;

  return (
    <div className="space-y-4">
      <Dialog.Description className="text-sm text-muted-foreground">
        Select workflows to import into this namespace. Each is copied once — updates require
        re-importing.
      </Dialog.Description>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {entries.length} workflow{entries.length !== 1 ? 's' : ''} found
        </span>
        <button onClick={onToggleAll} className="text-primary hover:underline">
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
        {entries.map((entry) => (
          <label
            key={entry.name}
            className="flex items-start gap-3 p-2 rounded cursor-pointer hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={selected.has(entry.name)}
              onChange={() => onToggle(entry.name)}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{entry.name}</p>
              {entry.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
              )}
              {entry.tags && entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onBack}
          className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
        >
          Back
        </button>
        <button
          onClick={onImport}
          disabled={importCount === 0}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Download className="h-3.5 w-3.5" />
          Import {importCount > 0 ? `${String(importCount)} ` : ''}workflow{importCount !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}

function ProgressStep({
  results,
  done,
  onClose,
}: {
  results: ImportResult[];
  done: boolean;
  onClose: () => void;
}) {
  const successCount = results.filter((r) => r.status === 'success').length;

  return (
    <div className="space-y-4">
      <Dialog.Description className="text-sm text-muted-foreground">
        {done
          ? `Imported ${String(successCount)} of ${String(results.length)} workflow${results.length !== 1 ? 's' : ''}.`
          : `Importing ${String(results.length)} workflow${results.length !== 1 ? 's' : ''}...`}
      </Dialog.Description>

      <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
        {results.map((result) => (
          <div key={result.name} className="flex items-start gap-3 p-2">
            <div className="mt-0.5 shrink-0">
              {result.status === 'pending' && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {result.status === 'success' && <Check className="h-4 w-4 text-green-500" />}
              {result.status === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{result.name}</p>
              {result.status === 'error' && (
                <p className="text-xs text-destructive mt-0.5">{result.message}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {done && (
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
