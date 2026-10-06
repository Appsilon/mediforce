'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileCode,
  Folder,
  FolderUp,
  Globe,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  SKILL_MANIFEST_PATH,
  SkillFilesSchema,
  WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
  fileTreeBytes,
  parseSkillFrontmatter,
  type AgentDefinition,
  type Skill,
  type SkillFile,
  type SkillVisibility,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import {
  compareSkillPaths,
  diffSkillFiles,
  entriesFromDrop,
  entriesFromFiles,
  readSkillUpload,
  type UploadedEntry,
} from '@/lib/skill-upload';
import { CodeEditor } from '@/components/workflows/workflow-editor/code-editor';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { secondaryButtonClass } from '@/components/ui/button-styles';
import { DeleteSkillDialog } from './delete-skill-dialog';
import { SkillHolders } from './skill-holders';

const TEMPLATE: SkillFile[] = [
  {
    path: SKILL_MANIFEST_PATH,
    contents: [
      '---',
      'name: my-skill',
      'description: What this skill does, and when an agent should use it.',
      '---',
      '',
      '# My skill',
      '',
      '## When to use',
      '',
      '## Instructions',
      '',
    ].join('\n'),
  },
];

interface Issues {
  /** The first problem with each file, by its index in the draft. */
  byFile: Map<number, string>;
  /** Problems with the set as a whole: size, a missing SKILL.md. */
  general: string[];
}

/**
 * The server's own rule, run on the draft, so the editor cannot accept what the
 * save then refuses. An existing Skill's `name` is fixed, which the schema
 * cannot know, so that is checked here too.
 */
function findIssues(files: SkillFile[], fixedId: string | null): Issues {
  const byFile = new Map<number, string>();
  const general: string[] = [];
  const result = SkillFilesSchema.safeParse(files);
  for (const issue of result.success ? [] : result.error.issues) {
    const index = issue.path[0];
    if (typeof index === 'number') {
      if (byFile.has(index) === false) byFile.set(index, issue.message);
    } else {
      general.push(issue.message);
    }
  }
  const manifestAt = files.findIndex((file) => file.path === SKILL_MANIFEST_PATH);
  const manifest = manifestAt === -1 ? null : parseSkillFrontmatter(files[manifestAt]?.contents ?? '');
  if (fixedId !== null && manifest?.success === true && manifest.data.name !== fixedId && byFile.has(manifestAt) === false) {
    byFile.set(
      manifestAt,
      `name is '${manifest.data.name}', but this skill is '${fixedId}'. The name is fixed: a rename is a new skill.`,
    );
  }
  return { byFile, general };
}

type TreeRow =
  | { kind: 'folder'; path: string; name: string; depth: number }
  | { kind: 'file'; index: number; name: string; depth: number };

/** The draft as a tree: SKILL.md first, then by path, each folder once above
 *  its files. Rows keep the file's index in the draft, which is what edits
 *  address, so a rename does not lose the selection. */
function treeRows(files: SkillFile[]): TreeRow[] {
  const order = files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => compareSkillPaths(left.file.path, right.file.path));
  const rows: TreeRow[] = [];
  const shown = new Set<string>();
  for (const { file, index } of order) {
    const segments = file.path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      if (shown.has(folder)) continue;
      shown.add(folder);
      rows.push({ kind: 'folder', path: folder, name: segments[depth - 1] ?? '', depth: depth - 1 });
    }
    rows.push({ kind: 'file', index, name: segments[segments.length - 1] ?? file.path, depth: segments.length - 1 });
  }
  return rows;
}

interface PendingUpload {
  files: SkillFile[];
  skipped: string[];
  added: string[];
  changed: string[];
  removed: string[];
}

function PathList({ label, paths, className }: { label: string; paths: string[]; className?: string }) {
  if (paths.length === 0) return null;
  return (
    <div className="text-xs">
      <p className={cn('font-medium', className)}>{label} ({paths.length})</p>
      <ul className="mt-0.5 space-y-0.5 pl-3">
        {paths.map((path) => (
          <li key={path} className="font-mono text-muted-foreground">{path}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Create, view or edit one Skill (ADR-0025): a file tree beside a text editor,
 * the name and description read live from SKILL.md, a visibility toggle, and
 * folder or `.zip` upload. `skill` is null when creating; `readOnly` is for a
 * Skill the viewer may not write, such as another workspace's public one.
 */
export function SkillEditor({
  handle,
  skill,
  readOnly,
  holders,
}: {
  handle: string;
  skill: Skill | null;
  readOnly: boolean;
  holders: AgentDefinition[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [files, setFiles] = React.useState<SkillFile[]>(skill?.files ?? TEMPLATE);
  const [visibility, setVisibility] = React.useState<SkillVisibility>(skill?.visibility ?? 'private');
  const [selected, setSelected] = React.useState(0);
  const [newPath, setNewPath] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingUpload | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [dropping, setDropping] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const folderPickerRef = React.useRef<HTMLInputElement>(null);
  const zipPickerRef = React.useRef<HTMLInputElement>(null);

  const issues = findIssues(files, skill?.id ?? null);
  const valid = issues.byFile.size === 0 && issues.general.length === 0;
  const manifest = parseSkillFrontmatter(files.find((file) => file.path === SKILL_MANIFEST_PATH)?.contents ?? '');
  const baseline = skill ?? { files: TEMPLATE, visibility: 'private' };
  const changed = visibility !== baseline.visibility || JSON.stringify(files) !== JSON.stringify(baseline.files);
  const current = files[selected];

  /** `read` is called before the first await: a drop's entries are only
   *  readable while its event is live. */
  const review = async (read: () => Promise<UploadedEntry[]>): Promise<void> => {
    setUploadError(null);
    try {
      const upload = await readSkillUpload(await read());
      if (upload.files.length === 0) {
        setUploadError('The upload holds no text files.');
        return;
      }
      // A new skill's untouched template is not something the upload changes.
      const replaced = skill === null && changed === false ? [] : files;
      setPending({ ...upload, ...diffSkillFiles(replaced, upload.files) });
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'The upload could not be read.');
    }
  };

  const applyUpload = (): void => {
    if (pending === null) return;
    setFiles(pending.files);
    setSelected(0);
    setPending(null);
  };

  const updateFile = (index: number, patch: Partial<SkillFile>): void => {
    setFiles((previous) => previous.map((file, at) => (at === index ? { ...file, ...patch } : file)));
  };

  const removeFile = (index: number): void => {
    setFiles((previous) => previous.filter((_, at) => at !== index));
    setSelected((previous) => (previous >= index ? Math.max(0, previous - 1) : previous));
  };

  const addFile = (): void => {
    const path = (newPath ?? '').trim();
    if (path === '') return;
    setFiles((previous) => [...previous, { path, contents: '' }]);
    setSelected(files.length);
    setNewPath(null);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      if (skill === null) {
        const { skill: created } = await mediforce.skills.create({ namespace: handle, files, visibility });
        queryClient.setQueryData(queryKeys.skill(created.namespace, created.id), created);
        await queryClient.invalidateQueries({ queryKey: queryKeys.skills(handle) });
        router.replace(routes.skill(handle, created.namespace, created.id));
        return;
      }
      const { skill: updated } = await mediforce.skills.update({ namespace: skill.namespace, id: skill.id, files, visibility });
      queryClient.setQueryData(queryKeys.skill(updated.namespace, updated.id), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills(handle) });
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const used = fileTreeBytes(files);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      {readOnly === false && <UnsavedChangesGuard when={changed} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={routes.skills(handle)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Skills
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-headline font-semibold">
            <span className="font-mono">{skill?.id ?? 'New skill'}</span>
            {skill !== null && skill.namespace !== handle && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">@{skill.namespace}</span>
            )}
          </h1>
          {skill !== null && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <SkillHolders holders={holders} handle={handle} />
            </p>
          )}
        </div>

        {readOnly ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground">
            {skill?.visibility === 'public' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            Read-only
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Visibility" className="inline-flex rounded-md border p-0.5">
              {(['private', 'public'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={visibility === option}
                  onClick={() => setVisibility(option)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    visibility === option ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option === 'public' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {option === 'public' ? 'Public' : 'Private'}
                </button>
              ))}
            </div>
            {skill !== null && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className={cn(secondaryButtonClass, 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive')}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || valid === false || (skill !== null && changed === false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {skill === null ? 'Create skill' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm" data-testid="skill-manifest">
        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</dt>
        <dd className="font-mono">{manifest.success ? manifest.data.name : '—'}</dd>
        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</dt>
        <dd>{manifest.success ? manifest.data.description : '—'}</dd>
        <dd className="col-span-2 text-[11px] text-muted-foreground">
          Read from the frontmatter of <code className="font-mono">SKILL.md</code>. An agent loads this skill when the
          description fits its task.
        </dd>
      </dl>

      {saveError !== null && (
        <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </div>
      )}
      {issues.general.map((message) => (
        <p key={message} className="text-sm text-destructive">{message}</p>
      ))}

      {pending !== null && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3" data-testid="skill-upload-review">
          <p className="text-sm font-medium">Replace this skill&apos;s files with the upload?</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PathList label="Added" paths={pending.added} className="text-emerald-700 dark:text-emerald-400" />
            <PathList label="Changed" paths={pending.changed} className="text-amber-700 dark:text-amber-400" />
            <PathList label="Removed" paths={pending.removed} className="text-destructive" />
            <PathList label="Skipped, not text" paths={pending.skipped} className="text-muted-foreground" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={applyUpload} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Replace files
            </button>
            <button type="button" onClick={() => setPending(null)} className={secondaryButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {uploadError !== null && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}

      <div
        onDragOver={(event) => {
          if (readOnly) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          if (readOnly) return;
          event.preventDefault();
          setDropping(false);
          const items = event.dataTransfer.items;
          void review(() => entriesFromDrop(items));
        }}
        className={cn('flex min-h-[28rem] flex-1 gap-4 rounded-lg', dropping && 'outline-dashed outline-2 outline-offset-4 outline-primary/60')}
      >
        <div className="flex w-64 shrink-0 flex-col gap-1">
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Skill files">
            {treeRows(files).map((row) =>
              row.kind === 'folder' ? (
                <li key={`folder:${row.path}`} className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }}>
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono">{row.name}/</span>
                </li>
              ) : (
                <li key={`file:${row.index}`}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                      row.index === selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
                    )}
                    style={{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }}
                  >
                    <button type="button" onClick={() => setSelected(row.index)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                      <FileCode className={cn('h-3.5 w-3.5 shrink-0', issues.byFile.has(row.index) && 'text-destructive')} />
                      <span className={cn('truncate font-mono', issues.byFile.has(row.index) && 'text-destructive')}>{row.name}</span>
                    </button>
                    {readOnly === false && files[row.index]?.path !== SKILL_MANIFEST_PATH && (
                      <button
                        type="button"
                        aria-label={`Remove ${files[row.index]?.path ?? ''}`}
                        onClick={() => removeFile(row.index)}
                        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>

          {readOnly === false && (
            <>
              {newPath !== null ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newPath}
                    placeholder="references/notes.md"
                    aria-label="New file path"
                    onChange={(event) => setNewPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addFile();
                      if (event.key === 'Escape') setNewPath(null);
                    }}
                    className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={addFile}
                    disabled={newPath.trim() === ''}
                    className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" onClick={() => setNewPath('')} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted">
                    <Plus className="h-3.5 w-3.5" />
                    Add file
                  </button>
                  <button
                    type="button"
                    onClick={() => folderPickerRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    <FolderUp className="h-3.5 w-3.5" />
                    Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => zipPickerRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    .zip
                  </button>
                </div>
              )}
              <input
                ref={folderPickerRef}
                type="file"
                multiple
                aria-label="Skill folder"
                className="hidden"
                // Not in React's JSX types, and the picker is the only way to
                // keep an uploaded folder's structure.
                {...{ webkitdirectory: '', directory: '' } as Record<string, string>}
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (picked.length > 0) void review(() => entriesFromFiles(picked));
                }}
              />
              <input
                ref={zipPickerRef}
                type="file"
                accept=".zip,application/zip"
                aria-label="Skill zip"
                className="hidden"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (picked.length > 0) void review(() => entriesFromFiles(picked));
                }}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatBytes(used)} of {formatBytes(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES)} used. Drop a skill folder or
                a .zip here to replace the files.
              </p>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {current === undefined ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              Select a file to edit it
            </div>
          ) : readOnly ? (
            <>
              <p className="font-mono text-xs text-muted-foreground">{current.path}</p>
              <pre className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px] whitespace-pre-wrap">
                {current.contents}
              </pre>
            </>
          ) : (
            <>
              <input
                value={current.path}
                aria-label="File path"
                disabled={current.path === SKILL_MANIFEST_PATH}
                onChange={(event) => updateFile(selected, { path: event.target.value })}
                className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-70"
              />
              {issues.byFile.has(selected) && (
                <p role="alert" className="text-xs text-destructive">{issues.byFile.get(selected)}</p>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto" data-testid="skill-file-editor">
                <CodeEditor value={current.contents} language="text" onChange={(contents) => updateFile(selected, { contents })} />
              </div>
            </>
          )}
        </div>
      </div>

      {deleteOpen && skill !== null && (
        <DeleteSkillDialog handle={handle} skill={skill} holders={holders} onClose={() => setDeleteOpen(false)} />
      )}
    </div>
  );
}
