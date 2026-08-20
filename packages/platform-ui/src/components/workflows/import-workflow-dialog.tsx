'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforce, ApiError } from '@/lib/mediforce';
import { WorkflowManifestGrid } from './workflow-manifest-grid';
import type { ManifestEntry } from '@mediforce/platform-api/contract';

const DEFAULT_REPO = 'https://github.com/Appsilon/mediforce';

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'manifest'; workflows: ManifestEntry[] }
  | { kind: 'importing'; workflows: ManifestEntry[]; progress: number; total: number }
  | { kind: 'done'; imported: string[] }
  | { kind: 'error'; message: string; workflows?: ManifestEntry[] };

/** 'source' asks for a repository first — the generic import. 'examples' skips
 *  that question and browses the Mediforce examples straight away, the entry
 *  point offered to a workspace with no workflows yet. */
export type ImportEntry = 'source' | 'examples';

export interface ImportWorkflowDialogProps {
  namespace: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
  entry?: ImportEntry;
}

export function ImportWorkflowDialog({
  namespace,
  open,
  onOpenChange,
  onImported,
  entry = 'source',
}: ImportWorkflowDialogProps) {
  const [repo, setRepo] = React.useState(DEFAULT_REPO);
  const [step, setStep] = React.useState<Step>({ kind: 'idle' });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Derived from the prop rather than seeded into state: the dialog stays
  // mounted between openings, so state seeded in the open effect would let the
  // previous session's view paint for a frame. The override lets a user reaching
  // for another repository drop into the source flow without the caller having
  // to re-open the dialog; it is cleared on close, before the next first paint.
  const [flowOverride, setFlowOverride] = React.useState<ImportEntry | null>(null);
  const flow = flowOverride ?? entry;
  // 'browse' lists workflows from the repo's workflows-index.json manifest; 'path'
  // imports a single .wd.json by its path (mirrors the CLI) for repos with no
  // manifest.
  const [mode, setMode] = React.useState<'browse' | 'path'>('browse');
  const [path, setPath] = React.useState('');
  // Branch, tag, or commit SHA to import from. Empty = default branch (main);
  // resolved to an immutable commit SHA server-side and recorded as provenance.
  const [ref, setRef] = React.useState('');
  // Non-fatal banner shown in the idle view, e.g. after a manifest fetch falls
  // back to path mode.
  const [idleError, setIdleError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRepo(DEFAULT_REPO);
    setStep({ kind: 'idle' });
    setSelected(new Set());
    setMode('browse');
    setPath('');
    setRef('');
    setIdleError(null);
    if (entry === 'examples') void fetchManifest({ repo: DEFAULT_REPO, ref: '' });
    // `entry` is read once per opening on purpose: changing it mid-session would
    // otherwise reset a flow the user is halfway through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    if (step.kind === 'importing') return;
    setFlowOverride(null);
    onOpenChange(false);
  }

  /** The examples flow fetches from the same effect that resets `repo` and
   *  `ref`, before those state updates land — so it passes them in rather than
   *  reading the closure, which still holds the previous opening's values. */
  async function fetchManifest(overrides: { repo?: string; ref?: string } = {}) {
    const sourceRepo = overrides.repo ?? repo;
    const sourceRef = (overrides.ref ?? ref).trim() || undefined;
    setStep({ kind: 'fetching' });
    setIdleError(null);
    try {
      const result = await mediforce.workflows.getManifest({
        repo: sourceRepo,
        ref: sourceRef,
      });
      // Start with nothing selected — the user opts workflows in explicitly.
      setSelected(new Set());
      setStep({ kind: 'manifest', workflows: result.workflows });
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to fetch manifest.');
      // The examples flow never asked for a repository, so path mode would be a
      // non-sequitur: report the failure and let the user retry or switch repos.
      if (flow === 'examples') {
        setStep({ kind: 'error', message });
        return;
      }
      // No manifest (e.g. repo has no workflows-index.json) is not a dead end —
      // drop into path mode so a single .wd.json can still be imported by its path.
      setMode('path');
      setIdleError(`${message} Add a workflows-index.json to enable browsing, or import a workflow by its path below.`);
      setStep({ kind: 'idle' });
    }
  }

  function switchToSourceFlow() {
    setFlowOverride('source');
    setSelected(new Set());
    setStep({ kind: 'idle' });
    setIdleError(null);
  }

  async function importByPath() {
    const trimmed = path.trim();
    if (trimmed === '') return;
    setStep({ kind: 'importing', workflows: [], progress: 0, total: 1 });
    try {
      await mediforce.workflows.importFromRepo({ repo, path: trimmed, ref: ref.trim() || undefined, namespace });
      setStep({ kind: 'done', imported: [trimmed] });
      onImported?.();
    } catch (err) {
      setStep({ kind: 'error', message: extractErrorMessage(err, 'Import failed.') });
    }
  }

  function toggleWorkflow(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function selectMany(names: string[], select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const name of names) {
        if (select) {
          next.add(name);
        } else {
          next.delete(name);
        }
      }
      return next;
    });
  }

  async function handleImport(workflows: ManifestEntry[]) {
    const toImport = workflows.filter((wf) => selected.has(wf.name));
    if (toImport.length === 0) return;
    setStep({ kind: 'importing', workflows, progress: 0, total: toImport.length });
    const imported: string[] = [];
    for (let i = 0; i < toImport.length; i++) {
      const wf = toImport[i];
      try {
        await mediforce.workflows.importFromRepo({
          repo,
          path: wf.path,
          ref: ref.trim() || undefined,
          namespace,
        });
        imported.push(wf.name);
        setStep({ kind: 'importing', workflows, progress: i + 1, total: toImport.length });
      } catch (err) {
        setStep({ kind: 'error', message: extractErrorMessage(err, 'Import failed.'), workflows });
        return;
      }
    }
    setStep({ kind: 'done', imported });
    onImported?.();
  }

  // The card grid needs the room; the plain forms — and a manifest that turned
  // out to list nothing — look stranded in it.
  const showsGrid =
    (step.kind === 'manifest' && step.workflows.length > 0) ||
    (step.kind === 'error' && step.workflows !== undefined && step.workflows.length > 0);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg focus:outline-none',
            showsGrid ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-base font-semibold">
              {flow === 'examples' ? 'Import example workflows' : 'Import from git'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Import workflow definitions from a GitHub repository.
          </Dialog.Description>

          {flow === 'examples' && step.kind === 'fetching' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading examples…</p>
            </div>
          )}

          {flow === 'source' && (step.kind === 'idle' || step.kind === 'fetching') && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="import-repo-url">
                  Repository URL
                </label>
                <input
                  id="import-repo-url"
                  type="url"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  disabled={step.kind === 'fetching'}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors',
                    'focus:ring-2 focus:ring-primary/30 focus:border-primary',
                    'disabled:opacity-50',
                  )}
                  placeholder="https://github.com/org/repo"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="import-ref">
                  Branch, tag, or commit <span className="font-normal">(optional — defaults to the source URL ref, or main)</span>
                </label>
                <input
                  id="import-ref"
                  type="text"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  disabled={step.kind === 'fetching'}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors',
                    'focus:ring-2 focus:ring-primary/30 focus:border-primary',
                    'disabled:opacity-50',
                  )}
                  placeholder="main"
                  autoComplete="off"
                />
              </div>

              <div className="inline-flex rounded-md border p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => { setMode('browse'); setIdleError(null); }}
                  className={cn(
                    'rounded px-3 py-1 transition-colors',
                    mode === 'browse' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Browse
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('path'); setIdleError(null); }}
                  className={cn(
                    'rounded px-3 py-1 transition-colors',
                    mode === 'path' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Import by path
                </button>
              </div>

              {idleError !== null && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{idleError}</span>
                </div>
              )}

              {mode === 'path' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="import-wf-path">
                    Path to .wd.json
                  </label>
                  <input
                    id="import-wf-path"
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors',
                      'focus:ring-2 focus:ring-primary/30 focus:border-primary',
                    )}
                    placeholder="workflow-name/src/workflow-name.wd.json"
                    autoComplete="off"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={handleClose}
                  className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                {mode === 'browse' ? (
                  <button
                    onClick={() => void fetchManifest()}
                    disabled={repo.trim() === '' || step.kind === 'fetching'}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                      repo.trim() !== '' && step.kind !== 'fetching'
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed',
                    )}
                  >
                    {step.kind === 'fetching' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Browse
                  </button>
                ) : (
                  <button
                    onClick={() => void importByPath()}
                    disabled={repo.trim() === '' || path.trim() === ''}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                      repo.trim() !== '' && path.trim() !== ''
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed',
                    )}
                  >
                    Import
                  </button>
                )}
              </div>
            </div>
          )}

          {step.kind === 'manifest' && (
            <ManifestView
              repo={repo}
              flow={flow}
              workflows={step.workflows}
              selected={selected}
              onToggle={toggleWorkflow}
              onSelectMany={selectMany}
              onImport={() => void handleImport(step.workflows)}
              onCancel={handleClose}
              onSwitchRepo={switchToSourceFlow}
            />
          )}

          {step.kind === 'importing' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Importing {step.progress} / {step.total}…
              </p>
              <div className="w-full rounded-full bg-muted h-1.5 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.round((step.progress / step.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {step.kind === 'done' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <p className="font-medium">
                  {step.imported.length === 1
                    ? `"${step.imported[0]}" imported successfully.`
                    : `${String(step.imported.length)} workflows imported successfully.`}
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleClose}
                  className="rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step.kind === 'error' && (
            <div className="space-y-4">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{step.message}</span>
              </div>
              {step.workflows !== undefined ? (
                <ManifestView
                  repo={repo}
                  flow={flow}
                  workflows={step.workflows}
                  selected={selected}
                  onToggle={toggleWorkflow}
                  onSelectMany={selectMany}
                  onImport={() => void handleImport(step.workflows!)}
                  onCancel={handleClose}
                  onSwitchRepo={switchToSourceFlow}
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  {flow === 'examples' ? (
                    <button onClick={switchToSourceFlow} className="text-xs text-primary hover:underline">
                      Import from another repository
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleClose}
                      className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void fetchManifest()}
                      className="rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ManifestViewProps {
  repo: string;
  flow: ImportEntry;
  workflows: ManifestEntry[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSelectMany: (names: string[], select: boolean) => void;
  onImport: () => void;
  onCancel: () => void;
  onSwitchRepo: () => void;
}

function ManifestView({
  repo,
  flow,
  workflows,
  selected,
  onToggle,
  onSelectMany,
  onImport,
  onCancel,
  onSwitchRepo,
}: ManifestViewProps) {
  const someSelected = workflows.some((wf) => selected.has(wf.name));
  const selectedCount = workflows.filter((wf) => selected.has(wf.name)).length;

  return (
    <div className="space-y-4">
      {flow === 'examples' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Ready-made workflows from the Mediforce repository — import them, run them, edit them.
          </p>
          <button onClick={onSwitchRepo} className="text-xs text-primary hover:underline shrink-0">
            Import from another repository
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground truncate" title={repo}>
          {repo}
        </p>
      )}

      {workflows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {flow === 'examples'
            ? 'No examples are published right now.'
            : 'No workflows found in this repository.'}
        </p>
      ) : (
        <WorkflowManifestGrid
          workflows={workflows}
          selected={selected}
          onToggle={onToggle}
          onSelectMany={onSelectMany}
        />
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {selectedCount} of {workflows.length} selected
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onImport}
            disabled={!someSelected}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              someSelected
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed',
            )}
          >
            Import selected
          </button>
        </div>
      </div>
    </div>
  );
}
