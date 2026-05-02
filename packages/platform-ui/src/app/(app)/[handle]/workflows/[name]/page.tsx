'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Layers, GitBranch, ExternalLink, Archive, ArchiveRestore, MoreVertical, Play, Clock, Zap, Trash2, ArrowRightLeft, KeyRound, Eye, EyeOff } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useMyTasks } from '@/hooks/use-tasks';
import { RunsTable } from '@/components/processes/runs-table';
import { DefinitionsList } from '@/components/workflows/definitions-list';
import { StartRunButton } from '@/components/processes/start-run-button';
import { setProcessArchived, transferWorkflowNamespace } from '@/app/actions/definitions';
import { VersionLabel } from '@/components/ui/version-label';
import { DeleteWorkflowDialog } from '@/components/workflows/delete-workflow-dialog';
import { formatCron } from '@/lib/format-cron';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { WorkflowSecretsEditor } from '@/components/workflows/workflow-secrets-editor';
import { WorkflowRepositoryEditor } from '@/components/workflows/workflow-repository-editor';


export default function ProcessDefinitionPage() {
  const { name, handle } = useParams<{ name: string; handle: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);

  const [showArchivedRuns, setShowArchivedRuns] = React.useState(false);

  const { versions, loading: versionsLoading } = useProcessDefinitionVersions(decodedName);
  const { data: runs, loading: runsLoading } = useProcessInstances('all', decodedName, showArchivedRuns);
  const { data: activeTasks } = useMyTasks(null);

  const activeTaskByInstance = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const task of activeTasks) {
      if (!map.has(task.processInstanceId)) {
        map.set(task.processInstanceId, task.id);
      }
    }
    return map;
  }, [activeTasks]);

  const { firebaseUser, loading: authLoading } = useAuth();
  const { namespaces } = useAllUserNamespaces(firebaseUser?.uid);

  const [archiving, setArchiving] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferTarget, setTransferTarget] = React.useState('');
  const [transferring, setTransferring] = React.useState(false);
  const [namespaceOverride, setNamespaceOverride] = React.useState<string | null>(null);
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

  const latest = versions[0] ?? null;
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
              {(namespaceOverride ?? latest?.namespace) && (
                <>
                  <span className="flex items-center gap-1">
                    Owned by{' '}
                    <Link
                      href={`/${namespaceOverride ?? latest?.namespace}`}
                      className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
                    >
                      @{namespaceOverride ?? latest?.namespace}
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
              <RepoLink definition={latest as Record<string, unknown>} />
              <AppLink definition={latest as Record<string, unknown>} />
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
                    await setProcessArchived(decodedName, willArchive);
                    setArchiving(false);
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
      <Tabs.Root defaultValue="runs" className="flex flex-1 flex-col">
        <Tabs.List className="flex border-b px-6 gap-0">
          {['runs', 'definitions', 'repository', 'secrets'].map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                'text-muted-foreground border-transparent',
                'data-[state=active]:text-foreground data-[state=active]:border-primary',
                'hover:text-foreground',
                (tab === 'secrets' || tab === 'repository') && 'flex items-center gap-1.5',
              )}
            >
              {tab === 'runs'
                ? `Runs${runs.length > 0 ? ` (${runs.length})` : ''}`
                : tab === 'secrets'
                  ? <><KeyRound className="h-3.5 w-3.5" />Secrets</>
                  : tab === 'repository'
                    ? <><GitBranch className="h-3.5 w-3.5" />Repository</>
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

        {/* Repository tab */}
        <Tabs.Content value="repository" className="flex-1 p-6">
          <div className="max-w-2xl">
            {firebaseUser && latest && (() => {
              const latestVersionNumber = Number(latest.version);
              if (!Number.isFinite(latestVersionNumber)) {
                return (
                  <p className="text-sm text-muted-foreground">
                    Repository config is only available for unified workflow definitions. The latest version of this workflow uses the legacy schema.
                  </p>
                );
              }
              const ws = (latest as { workspace?: { remote?: string; remoteAuth?: string } }).workspace;
              return (
                <WorkflowRepositoryEditor
                  namespace={handle}
                  workflowName={decodedName}
                  userId={firebaseUser.uid}
                  initialRemote={ws?.remote}
                  initialRemoteAuth={ws?.remoteAuth}
                  latestVersion={latestVersionNumber}
                />
              );
            })()}
          </div>
        </Tabs.Content>

        {/* Secrets tab */}
        <Tabs.Content value="secrets" className="flex-1 p-6">
          <div className="max-w-2xl">
            {firebaseUser && (
              <WorkflowSecretsEditor
                namespace={handle}
                workflowName={decodedName}
                userId={firebaseUser.uid}
              />
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>

      <DeleteWorkflowDialog
        workflowName={decodedName}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onDeleted={() => router.push(`/${handle}`)}
      />

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
                  const result = await transferWorkflowNamespace(decodedName, transferTarget);
                  setTransferring(false);
                  if (result.success) {
                    setNamespaceOverride(transferTarget);
                    setTransferOpen(false);
                    setTransferTarget('');
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

function RepoLink({ definition }: { definition: Record<string, unknown> | null }) {
  if (!definition?.repo) return null;
  const repo = definition.repo as { url: string; branch?: string; directory?: string };
  let href = repo.url;
  if (repo.branch) {
    href += `/tree/${repo.branch}`;
    if (repo.directory) href += `/${repo.directory}`;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      title={[repo.branch, repo.directory].filter(Boolean).join('/') || undefined}
    >
      <GitBranch className="h-3 w-3" />
      Repo
    </a>
  );
}

function AppLink({ definition }: { definition: Record<string, unknown> | null }) {
  if (!definition?.url) return null;
  return (
    <a
      href={definition.url as string}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      <ExternalLink className="h-3 w-3" />
      App
    </a>
  );
}
