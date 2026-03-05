'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Layers, ChevronRight, Github, ExternalLink, Archive, ArchiveRestore, MoreVertical } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { ProcessStatusBadge } from '@/components/processes/process-status-badge';
import { YamlEditor } from '@/components/processes/yaml-editor';
import { definitionToYaml } from '@/app/actions/definitions';
import { ConfigList } from '@/components/configs/config-list';
import { setProcessArchived } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

export default function ProcessDefinitionPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);

  const { versions, loading: versionsLoading } = useProcessDefinitionVersions(decodedName);
  const { data: runs, loading: runsLoading } = useProcessInstances('all', decodedName);

  const [selectedVersion, setSelectedVersion] = React.useState<string | null>(null);
  const [editorYaml, setEditorYaml] = React.useState('');
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
  const activeVersion = selectedVersion
    ? versions.find((v) => v.version === selectedVersion) ?? latest
    : latest;

  // Reconstruct YAML from stored definition when version is selected
  React.useEffect(() => {
    if (!activeVersion) return;
    // Omit internal Firestore fields, stringify back to YAML
    definitionToYaml(activeVersion as Record<string, unknown>).then(setEditorYaml);
  }, [activeVersion?.version]); // eslint-disable-line react-hooks/exhaustive-deps

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
        Process &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link href="/processes" className="underline">Back to catalog</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <Link
          href="/processes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Processes
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
              <span className="font-mono bg-muted px-1.5 py-0.5 rounded">v{latest?.version}</span>
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {latest?.steps.length} steps
              </span>
              <span>{runs.length} runs</span>
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
                      router.push('/processes');
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
          {['runs', 'configs', 'definition'].map((tab) => (
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
              {tab === 'runs' ? `Runs${runs.length > 0 ? ` (${runs.length})` : ''}` : tab === 'configs' ? 'Configurations' : 'Definition'}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Runs tab */}
        <Tabs.Content value="runs" className="flex-1 p-6">
          {runsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No runs yet for this process.
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">Run ID</th>
                    <th className="px-4 py-2.5 text-left font-medium">Version</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Current Step</th>
                    <th className="px-4 py-2.5 text-left font-medium">Started</th>
                    <th className="px-4 py-2.5 text-left font-medium w-8" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {run.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{run.definitionVersion}</td>
                      <td className="px-4 py-3">
                        <ProcessStatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {run.currentStepId ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/processes/${encodeURIComponent(decodedName)}/runs/${run.id}`}
                          className="text-primary hover:underline inline-flex items-center gap-0.5 text-xs"
                        >
                          View <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tabs.Content>

        {/* Configurations tab */}
        <Tabs.Content value="configs" className="flex-1 p-6">
          <div className="max-w-2xl">
            <ConfigList processName={decodedName} />
          </div>
        </Tabs.Content>

        {/* Definition tab */}
        <Tabs.Content value="definition" className="flex-1 p-6">
          <div className="max-w-3xl space-y-4">
            {versions.length > 1 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Versions</h3>
                <div className="space-y-2">
                  {versions.map((v) => (
                    <button
                      key={v.version}
                      onClick={() => setSelectedVersion(v.version)}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-lg border px-4 py-2.5 text-left transition-colors',
                        activeVersion?.version === v.version
                          ? 'border-primary bg-primary/5'
                          : 'bg-card hover:bg-muted/50',
                      )}
                    >
                      <span className="font-mono text-sm font-medium">v{v.version}</span>
                      {v.version === latest?.version && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          latest
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{v.steps.length} steps</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Edit and save as a new version — existing runs are unaffected.
            </p>
            <YamlEditor
              key={activeVersion?.version}
              initialValue={editorYaml}
              onSaved={(_, version) => setSelectedVersion(version)}
            />
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
