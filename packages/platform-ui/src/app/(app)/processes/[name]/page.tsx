'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Layers, Github, ExternalLink, Archive, ArchiveRestore, MoreVertical, Play, Info, Eye, EyeOff, Clock, Zap } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { YamlEditor } from '@/components/processes/yaml-editor';
import { definitionToYaml } from '@/app/actions/definitions';
import { ConfigList } from '@/components/configs/config-list';
import { RunsTable } from '@/components/processes/runs-table';
import { StartRunDialog } from '@/components/processes/start-run-dialog';
import { setProcessArchived, setDefinitionVersionArchived } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';


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
  const [startRunOpen, setStartRunOpen] = React.useState(false);
  const [showArchivedVersions, setShowArchivedVersions] = React.useState(false);
  const [archiveOverrides, setArchiveOverrides] = React.useState<Record<string, boolean>>({});
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
  const activeVersion = selectedVersion
    ? versions.find((v) => v.version === selectedVersion) ?? latest
    : latest;

  const effectiveVersions = versions.map((v) =>
    v.version in archiveOverrides ? { ...v, archived: archiveOverrides[v.version] } : v,
  );
  const activeVersions = effectiveVersions.filter((v) => v.archived !== true);
  const archivedVersionCount = effectiveVersions.length - activeVersions.length;
  const visibleVersions = showArchivedVersions ? effectiveVersions : activeVersions;

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
        Workflow &ldquo;{decodedName}&rdquo; not found.{' '}
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
              <span className="font-mono bg-muted px-1.5 py-0.5 rounded">v{latest?.version}</span>
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
          <div className="flex items-center justify-between mb-4">
            <div />
            {hasManualTrigger ? (
              <button
                onClick={() => setStartRunOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
                Start Run
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                This workflow does not support manual start
              </span>
            )}
          </div>

          <StartRunDialog
            processName={decodedName}
            definitionVersion={latest?.version ?? ''}
            open={startRunOpen}
            onClose={() => setStartRunOpen(false)}
          />

          <RunsTable
            runs={runs}
            loading={runsLoading}
            emptyMessage="No runs yet for this workflow."
          />
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
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Versions</h3>
                  {archivedVersionCount > 0 && (
                    <button
                      onClick={() => setShowArchivedVersions((prev) => !prev)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                    >
                      {showArchivedVersions ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {showArchivedVersions ? 'Hide' : 'Show'} archived ({archivedVersionCount})
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {visibleVersions.map((v) => (
                    <div
                      key={v.version}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedVersion(v.version)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedVersion(v.version); }}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-lg border px-4 py-2.5 text-left transition-colors cursor-pointer',
                        activeVersion?.version === v.version
                          ? 'border-primary bg-primary/5'
                          : 'bg-card hover:bg-muted/50',
                        v.archived === true && 'opacity-60',
                      )}
                    >
                      <span className="font-mono text-sm font-medium">v{v.version}</span>
                      {v.version === latest?.version && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          latest
                        </span>
                      )}
                      {v.archived === true && (
                        <span className="text-xs text-muted-foreground">(archived)</span>
                      )}
                      <span className="text-xs text-muted-foreground">{v.steps.length} steps</span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newArchived = v.archived !== true;
                          setArchiveOverrides((prev) => ({ ...prev, [v.version]: newArchived }));
                          const result = await setDefinitionVersionArchived(decodedName, v.version, newArchived);
                          if (!result.success) {
                            setArchiveOverrides((prev) => {
                              const next = { ...prev };
                              delete next[v.version];
                              return next;
                            });
                          }
                        }}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
                        title={v.archived ? 'Unarchive version' : 'Archive version'}
                      >
                        {v.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      </button>
                    </div>
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
