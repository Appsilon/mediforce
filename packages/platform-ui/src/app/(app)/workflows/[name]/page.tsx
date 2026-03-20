'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Layers, Github, ExternalLink, Archive, ArchiveRestore, MoreVertical, Play, Info, Clock, Zap } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { RunsTable } from '@/components/processes/runs-table';
import { DefinitionsList } from '@/components/workflows/definitions-list';
import { StartRunButton } from '@/components/processes/start-run-button';
import { setProcessArchived } from '@/app/actions/definitions';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';


export default function ProcessDefinitionPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);

  const { versions, loading: versionsLoading } = useProcessDefinitionVersions(decodedName);
  const { data: runs, loading: runsLoading } = useProcessInstances('all', decodedName);

  const [archiving, setArchiving] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
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

  if (versionsLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (!versionsLoading && versions.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Workflow &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link href="/workflows" className="underline">Back to catalog</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <Link
          href="/workflows"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Workflows
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-headline font-semibold">{decodedName}</h1>
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
              {latest && <VersionLabel version={latest.version} title={(latest as unknown as { title?: string }).title} />}
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {latest?.steps.length} steps
              </span>
              <span>{runs.length} runs</span>
              {latest?.triggers?.map((trigger: { type: string; name: string; schedule?: string }) => (
                <span key={trigger.name} className="inline-flex items-center gap-1">
                  {trigger.type === 'cron' ? <Clock className="h-3 w-3" /> : trigger.type === 'manual' ? <Play className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                  {trigger.type === 'cron' && trigger.schedule ? (
                    <span className="font-mono bg-muted px-1.5 py-0.5 rounded" title={`Cron: ${trigger.schedule}`}>{trigger.name}: {trigger.schedule}</span>
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
                      router.push('/workflows');
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
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="runs" className="flex flex-1 flex-col">
        <Tabs.List className="flex border-b px-6 gap-0">
          {['runs', 'definitions'].map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                'text-muted-foreground border-transparent',
                'data-[state=active]:text-foreground data-[state=active]:border-primary',
                'hover:text-foreground',
              )}
            >
              {tab === 'runs' ? `Runs${runs.length > 0 ? ` (${runs.length})` : ''}` : 'Definitions'}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Runs tab */}
        <Tabs.Content value="runs" className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <div />
            {hasManualTrigger ? (
              <StartRunButton workflowName={decodedName} showVersionPicker />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                This workflow does not support manual start
              </span>
            )}
          </div>

          <RunsTable
            runs={runs}
            loading={runsLoading}
            emptyMessage="No runs yet for this workflow."
          />
        </Tabs.Content>

        {/* Definitions tab */}
        <Tabs.Content value="definitions" className="flex-1 p-6">
          <div className="max-w-2xl">
            <DefinitionsList workflowName={decodedName} />
          </div>
        </Tabs.Content>
      </Tabs.Root>
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
      <Github className="h-3 w-3" />
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
