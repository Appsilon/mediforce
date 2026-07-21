'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Layers, GitBranch, ExternalLink, Archive, ArchiveRestore, MoreVertical, Play, Clock, Zap, Trash2, ArrowRightLeft, KeyRound, Eye, EyeOff, Copy } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useWorkflowVersion, useWorkflowVersions } from '@/hooks/use-workflow-versions';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useMyActionableTasks } from '@/hooks/use-tasks';
import { RunsTable } from '@/components/processes/runs-table';
import { DefinitionsList } from '@/components/workflows/definitions-list';
import { StartRunButton } from '@/components/processes/start-run-button';
import { mediforce, ApiError } from '@/lib/mediforce';
import { apiFetch } from '@/lib/api-fetch';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { VersionLabel } from '@/components/ui/version-label';
import { DeleteWorkflowDialog } from '@/components/workflows/delete-workflow-dialog';
import { formatCron } from '@/lib/format-cron';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { useWorkflowDefinitionApi } from '@/hooks/use-workflows-api';
import { WorkflowSecretsEditor } from '@/components/workflows/workflow-secrets-editor';


export default function ProcessDefinitionPage() {
  const { name, handle } = useParams<{ name: string; handle: string }>();
  const { role, loading: roleLoading } = useNamespaceRole(handle);

  if (roleLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (role === null) {
    return <ProcessDefinitionPagePublic name={name} handle={handle} />;
  }

  return <ProcessDefinitionPageMember name={name} handle={handle} />;
}

function ProcessDefinitionPagePublic({ name, handle }: { name: string; handle: string }) {
  const decodedName = decodeURIComponent(name);
  const router = useRouter();
  const { definition, loading, error } = useWorkflowDefinitionApi(handle, decodedName);
  const { user } = useAuth();
  const { namespaces } = useAllUserNamespaces(user?.id);

  const [copyOpen, setCopyOpen] = React.useState(false);
  const [copyTarget, setCopyTarget] = React.useState('');
  const [copyName, setCopyName] = React.useState('');
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (error !== null || definition === null) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Workflow &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link href={`/${handle}`} className="underline">Back to catalog</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0">
      <div className="border-b px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            {definition.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{definition.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              {definition.namespace && (
                <>
                  <span className="flex items-center gap-1">
                    Owned by{' '}
                    <Link
                      href={`/${definition.namespace}`}
                      className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
                    >
                      @{definition.namespace}
                    </Link>
                  </span>
                  <span className="text-border">&middot;</span>
                </>
              )}
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {definition.steps.length} steps
              </span>
              <RepoLink definition={definition} />
              <AppLink definition={definition} />
            </div>
          </div>

          {namespaces.length > 0 && (
            <button
              onClick={() => {
                setCopyName(decodedName);
                setCopyError('');
                setCopyOpen(true);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy to...
            </button>
          )}
        </div>
      </div>

      {/* Copy to namespace dialog */}
      {copyOpen && (
        <CopyWorkflowDialog
          decodedName={decodedName}
          namespaces={namespaces}
          copyTarget={copyTarget}
          setCopyTarget={(v) => { setCopyTarget(v); setCopyError(''); }}
          copyName={copyName}
          setCopyName={(v) => { setCopyName(v); setCopyError(''); }}
          copyError={copyError}
          copying={copying}
          onCancel={() => { setCopyOpen(false); setCopyTarget(''); setCopyName(''); setCopyError(''); }}
          onCopy={async () => {
            if (!copyTarget || !copyName.trim()) return;
            setCopying(true);
            setCopyError('');
            try {
              const qs = new URLSearchParams({ targetNamespace: copyTarget, namespace: handle });
              const body: Record<string, unknown> = {};
              if (copyName !== decodedName) body.targetName = copyName;
              const res = await apiFetch(
                `/api/workflow-definitions/${encodeURIComponent(decodedName)}/copy?${qs}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                },
              );
              if (res.ok) {
                setCopyOpen(false);
                router.push(`/${copyTarget}/workflows/${encodeURIComponent(copyName)}`);
              } else {
                const data = await res.json().catch(() => null);
                setCopyError(data?.error ?? 'Copy failed');
              }
            } finally {
              setCopying(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ProcessDefinitionPageMember({ name, handle }: { name: string; handle: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const decodedName = decodeURIComponent(name);

  const initialTab = searchParams.get('tab') === 'secrets' ? 'secrets' : 'runs';
  const setupKeys = searchParams.get('setup')?.split(',').filter(Boolean) ?? [];
  const [activeTab, setActiveTab] = React.useState(initialTab);
  const [showArchivedRuns, setShowArchivedRuns] = React.useState(false);

  const { versions, loading: versionsLoading } = useWorkflowVersions(decodedName, handle);
  // The page header reads the full latest definition (visibility, triggers,
  // steps[], repo, url, copiedFrom) which the metadata summary does not
  // carry. Fetch it once per workflow.
  const latestVersionNumber = versions[0]?.version ?? null;
  const { definition: latest } = useWorkflowVersion(decodedName, handle, latestVersionNumber);
  const { data: runs, loading: runsLoading } = useProcessInstances('all', decodedName, showArchivedRuns, handle);
  const { data: activeTasks } = useMyActionableTasks();

  const activeTaskByInstance = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const task of activeTasks) {
      if (!map.has(task.processInstanceId)) {
        map.set(task.processInstanceId, task.id);
      }
    }
    return map;
  }, [activeTasks]);

  const { user, loading: authLoading } = useAuth();
  const { namespaces } = useAllUserNamespaces(user?.id);

  const [archiving, setArchiving] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferTarget, setTransferTarget] = React.useState('');
  const [transferring, setTransferring] = React.useState(false);
  const [togglingVisibility, setTogglingVisibility] = React.useState(false);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [copyTarget, setCopyTarget] = React.useState('');
  const [copyName, setCopyName] = React.useState('');
  const [copyVersion, setCopyVersion] = React.useState<number | null>(null);
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');
  const [visibilityOverride, setVisibilityOverride] = React.useState<'public' | 'private' | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const currentVisibility = visibilityOverride ?? latest?.visibility ?? 'private';
  const isPrivate = currentVisibility === 'private';
  const hasManualTrigger = latest?.triggers?.some(
    (trigger: { type: string }) => trigger.type === 'manual',
  ) ?? false;

  if (versionsLoading || authLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (!versionsLoading && !authLoading && versions.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Workflow &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link href={`/${handle}`} className="underline">Back to catalog</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {isPrivate && (
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                  Private
                </span>
              )}
              {latest?.archived && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Archived
                </span>
              )}
            </div>
            {latest?.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{latest.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              {(latest?.namespace) && (
                <>
                  <span className="flex items-center gap-1">
                    Owned by{' '}
                    <Link
                      href={`/${latest?.namespace}`}
                      className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
                    >
                      @{latest?.namespace}
                    </Link>
                  </span>
                  <span className="text-border">·</span>
                </>
              )}
              {latest?.copiedFrom && (
                <>
                  <span className="flex items-center gap-1">
                    <Copy className="h-3 w-3" />
                    Copied from{' '}
                    <Link
                      href={`/${latest.copiedFrom!.namespace}/workflows/${encodeURIComponent(latest.copiedFrom!.name)}`}
                      className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[11px] font-medium text-purple-600 hover:bg-purple-500/20 transition-colors"
                    >
                      @{latest.copiedFrom!.namespace}/{latest.copiedFrom!.name} v{latest.copiedFrom!.version}
                    </Link>
                  </span>
                  <span className="text-border">·</span>
                </>
              )}
              {latest && <VersionLabel version={latest.version} title={latest.title} />}
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {latest?.steps.length} steps
              </span>
              <span>{runs.length} runs</span>
              {latest?.triggers?.map((trigger: { type: string; name: string; schedule?: string }) => (
                <span key={trigger.name} className="inline-flex items-center gap-1">
                  {trigger.type === 'cron' ? <Clock className="h-3 w-3" /> : trigger.type === 'manual' ? <Play className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                  {trigger.type === 'cron' && trigger.schedule ? (
                    <span className="bg-muted px-1.5 py-0.5 rounded" title={trigger.schedule}>Runs automatically · {formatCron(trigger.schedule)}</span>
                  ) : (
                    <span>{trigger.name}</span>
                  )}
                </span>
              ))}
              <RepoLink definition={latest} />
              <AppLink definition={latest} />
            </div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 min-w-[160px] rounded-md border bg-popover p-1 shadow-md">
                <button
                  onClick={async () => {
                    const willArchive = !latest?.archived;
                    setMenuOpen(false);
                    setArchiving(true);
                    try {
                      await mediforce.workflows.archiveAll(
                        { name: decodedName, archived: willArchive },
                        { namespace: handle },
                      );
                    } finally {
                      setArchiving(false);
                    }
                    if (willArchive) {
                      router.push(`/${handle}`);
                    }
                  }}
                  disabled={archiving}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    archiving && 'opacity-50 pointer-events-none',
                  )}
                >
                  {latest?.archived ? (
                    <>
                      <ArchiveRestore className="h-3.5 w-3.5" />
                      Unarchive
                    </>
                  ) : (
                    <>
                      <Archive className="h-3.5 w-3.5" />
                      Archive
                    </>
                  )}
                </button>

                <button
                  onClick={async () => {
                    const newVisibility = isPrivate ? 'public' : 'private';
                    setMenuOpen(false);
                    setTogglingVisibility(true);
                    try {
                      const res = await apiFetch(`/api/workflow-definitions/${encodeURIComponent(decodedName)}?namespace=${encodeURIComponent(handle)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ visibility: newVisibility }),
                      });
                      if (res.ok) {
                        setVisibilityOverride(newVisibility);
                      } else {
                        const body = await res.json().catch(() => null);
                        const msg = typeof body?.error === 'object' && body?.error !== null
                          ? (body.error.message ?? 'Failed to update visibility')
                          : (body?.error ?? 'Failed to update visibility');
                        alert(msg);
                      }
                    } finally {
                      setTogglingVisibility(false);
                    }
                  }}
                  disabled={togglingVisibility}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    togglingVisibility && 'opacity-50 pointer-events-none',
                  )}
                >
                  {isPrivate ? (
                    <><Eye className="h-3.5 w-3.5" />Make public</>
                  ) : (
                    <><EyeOff className="h-3.5 w-3.5" />Make private</>
                  )}
                </button>

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setTransferOpen(true);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Transfer
                </button>

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setCopyName(decodedName);
                    setCopyVersion(null);
                    setCopyError('');
                    setCopyOpen(true);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy to...
                </button>

                <div className="my-1 border-t" />

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteDialogOpen(true);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                    'text-destructive hover:bg-destructive/10',
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col">
        <Tabs.List className="flex border-b px-6 gap-0">
          {['runs', 'definitions', 'secrets'].map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                'text-muted-foreground border-transparent',
                'data-[state=active]:text-foreground data-[state=active]:border-primary',
                'hover:text-foreground',
                tab === 'secrets' && 'flex items-center gap-1.5',
              )}
            >
              {tab === 'runs'
                ? `Runs${runs.length > 0 ? ` (${runs.length})` : ''}`
                : tab === 'secrets'
                  ? <><KeyRound className="h-3.5 w-3.5" />Secrets</>
                  : 'Definitions'}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Runs tab */}
        <Tabs.Content value="runs" className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setShowArchivedRuns((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                showArchivedRuns
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
              )}
            >
              {showArchivedRuns
                ? <><EyeOff className="h-3.5 w-3.5" />Hide archived</>
                : <><Eye className="h-3.5 w-3.5" />Show archived</>}
            </button>
            <StartRunButton
              workflowName={decodedName}
              showVersionPicker
              hasManualTrigger={hasManualTrigger}
              archived={latest?.archived === true}
            />
          </div>

          <RunsTable
            runs={runs}
            loading={runsLoading}
            activeTaskByInstance={activeTaskByInstance}
            emptyMessage="No runs yet for this workflow."
          />
        </Tabs.Content>

        {/* Definitions tab */}
        <Tabs.Content value="definitions" className="flex-1 p-6">
          <div className="max-w-2xl">
            <DefinitionsList workflowName={decodedName} />
          </div>
        </Tabs.Content>

        {/* Secrets tab */}
        <Tabs.Content value="secrets" className="flex-1 p-6">
          <div className="max-w-2xl">
            {user && (
              <WorkflowSecretsEditor
                namespace={handle}
                workflowName={decodedName}
                suggestedKeys={setupKeys}
              />
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>

      <DeleteWorkflowDialog
        workflowName={decodedName}
        namespace={handle}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onDeleted={() => router.push(`/${handle}`)}
      />

      {/* Copy to namespace dialog */}
      {copyOpen && (
        <CopyWorkflowDialog
          decodedName={decodedName}
          namespaces={namespaces}
          copyTarget={copyTarget}
          setCopyTarget={(v) => { setCopyTarget(v); setCopyError(''); }}
          copyName={copyName}
          setCopyName={(v) => { setCopyName(v); setCopyError(''); }}
          copyError={copyError}
          copying={copying}
          versions={versions}
          copyVersion={copyVersion}
          setCopyVersion={setCopyVersion}
          onCancel={() => { setCopyOpen(false); setCopyTarget(''); setCopyName(''); setCopyError(''); }}
          onCopy={async () => {
            if (!copyTarget || !copyName.trim()) return;
            setCopying(true);
            setCopyError('');
            try {
              const qs = new URLSearchParams({ targetNamespace: copyTarget, namespace: handle });
              const body: Record<string, unknown> = {};
              if (copyName !== decodedName) body.targetName = copyName;
              if (copyVersion !== null) body.version = copyVersion;
              const res = await apiFetch(
                `/api/workflow-definitions/${encodeURIComponent(decodedName)}/copy?${qs}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                },
              );
              if (res.ok) {
                setCopyOpen(false);
                setCopyTarget('');
                setCopyName('');
                router.push(`/${copyTarget}/workflows/${encodeURIComponent(copyName)}`);
              } else {
                const data = await res.json().catch(() => null);
                setCopyError(data?.error ?? 'Copy failed');
              }
            } finally {
              setCopying(false);
            }
          }}
        />
      )}

      {/* Transfer namespace dialog */}
      {transferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border bg-popover p-6 shadow-lg">
            <h3 className="text-base font-semibold mb-1">Transfer ownership</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Transfer <span className="font-mono">{decodedName}</span> to a different namespace.
            </p>
            <select
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none mb-4',
                'focus:ring-1 focus:ring-ring focus:border-ring',
              )}
            >
              <option value="">Select namespace...</option>
              {namespaces.map((ns) => (
                <option key={ns.handle} value={ns.handle}>
                  {ns.displayName ?? ns.handle} (@{ns.handle})
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setTransferOpen(false);
                  setTransferTarget('');
                }}
                className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!transferTarget) return;
                  setTransferring(true);
                  try {
                    await mediforce.workflows.transferNamespace({
                      name: decodedName,
                      sourceNamespace: handle,
                      targetNamespace: transferTarget,
                    });
                    setTransferOpen(false);
                    router.push(`/${transferTarget}/workflows/${encodeURIComponent(decodedName)}`);
                  } catch (err) {
                    const message = err instanceof ApiError ? err.message
                      : err instanceof Error ? err.message : 'Unknown error';
                    alert(`Failed to transfer workflow: ${message}`);
                  } finally {
                    setTransferring(false);
                  }
                }}
                disabled={!transferTarget || transferring}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {transferring ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RepoLink({ definition }: { definition: { externalSkillsRepo?: { url: string; commit?: string } } | null }) {
  if (!definition?.externalSkillsRepo?.url) return null;
  const { url, commit } = definition.externalSkillsRepo;
  const href = commit ? `${url}/tree/${commit}` : url;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      title={commit ?? undefined}
    >
      <GitBranch className="h-3 w-3" />
      Repo
    </a>
  );
}

function AppLink({ definition }: { definition: { url?: string } | null }) {
  if (!definition?.url) return null;
  return (
    <a
      href={definition.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      <ExternalLink className="h-3 w-3" />
      App
    </a>
  );
}

function CopyWorkflowDialog({
  decodedName,
  namespaces,
  copyTarget,
  setCopyTarget,
  copyName,
  setCopyName,
  copyError,
  copying,
  versions,
  copyVersion,
  setCopyVersion,
  onCancel,
  onCopy,
}: {
  decodedName: string;
  namespaces: { handle: string; displayName?: string | null }[];
  copyTarget: string;
  setCopyTarget: (v: string) => void;
  copyName: string;
  setCopyName: (v: string) => void;
  copyError: string;
  copying: boolean;
  versions?: { version: number; title?: string }[];
  copyVersion?: number | null;
  setCopyVersion?: (v: number | null) => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border bg-popover p-6 shadow-lg">
        <h3 className="text-base font-semibold mb-1">Copy to namespace</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Copy <span className="font-mono">{decodedName}</span> to another namespace.
        </p>
        <label className="block text-sm font-medium mb-1">Target namespace</label>
        <select
          value={copyTarget}
          onChange={(e) => setCopyTarget(e.target.value)}
          className={cn(
            'w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none mb-3',
            'focus:ring-1 focus:ring-ring focus:border-ring',
          )}
        >
          <option value="">Select namespace...</option>
          {namespaces.map((ns) => (
            <option key={ns.handle} value={ns.handle}>
              {ns.displayName ?? ns.handle} (@{ns.handle})
            </option>
          ))}
        </select>
        <label className="block text-sm font-medium mb-1">Workflow name</label>
        <input
          type="text"
          value={copyName}
          onChange={(e) => setCopyName(e.target.value)}
          className={cn(
            'w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none mb-3',
            'focus:ring-1 focus:ring-ring focus:border-ring',
            copyError && 'border-destructive',
          )}
        />
        {copyError && (
          <p className="text-xs text-destructive mb-3">{copyError}</p>
        )}
        {versions && versions.length > 0 && setCopyVersion && (
          <>
            <label className="block text-sm font-medium mb-1">Version</label>
            <select
              value={copyVersion ?? ''}
              onChange={(e) => setCopyVersion(e.target.value ? Number(e.target.value) : null)}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none mb-4',
                'focus:ring-1 focus:ring-ring focus:border-ring',
              )}
            >
              <option value="">Latest</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}{v.title ? ` — ${v.title}` : ''}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onCopy}
            disabled={!copyTarget || !copyName.trim() || copying}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {copying ? 'Copying...' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
