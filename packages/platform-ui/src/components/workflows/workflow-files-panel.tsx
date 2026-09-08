'use client';

import * as React from 'react';
import { FileCode, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  WorkflowArtifactSchema,
  WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
  validateArtifacts,
  type WorkflowArtifact,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { CodeEditor } from './workflow-editor/code-editor';

/** The server's own rule, run on the draft: one implementation decides whether
 *  a set of files is registerable, so the panel cannot say yes to something the
 *  save then refuses. */
const ArtifactSetSchema = z
  .object({ artifacts: z.array(WorkflowArtifactSchema).optional() })
  .superRefine(validateArtifacts);

function firstIssue(artifacts: WorkflowArtifact[]): string | null {
  const result = ArtifactSetSchema.safeParse({ artifacts });
  return result.success ? null : (result.error.issues[0]?.message ?? 'These files cannot be saved.');
}

function totalBytes(artifacts: WorkflowArtifact[]): number {
  const encoder = new TextEncoder();
  return artifacts.reduce(
    (sum, artifact) => sum + encoder.encode(artifact.path).length + encoder.encode(artifact.contents).length,
    0,
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * The files this workflow carries: a script a step runs, a Dockerfile its image
 * is built from, a SKILL.md an agent reads. They save with the next version and
 * appear in the container at `/artifacts`, so a workflow written here needs no
 * repository and no checkout to run.
 */
export function WorkflowFilesPanel({
  artifacts,
  onChange,
}: {
  artifacts: WorkflowArtifact[];
  onChange: (next: WorkflowArtifact[]) => void;
}) {
  const [selected, setSelected] = React.useState(0);
  const [newPath, setNewPath] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  const issue = firstIssue(artifacts);
  const used = totalBytes(artifacts);
  const current = artifacts[selected];

  const addFile = (): void => {
    const path = newPath.trim();
    if (path === '') return;
    onChange([...artifacts, { path, contents: '' }]);
    setSelected(artifacts.length);
    setNewPath('');
    setAdding(false);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex w-56 shrink-0 flex-col gap-1">
        {artifacts.length === 0 && (
          <p className="mb-1 text-xs text-muted-foreground">
            No files yet. Add one and a step can run it: a command reads it from{' '}
            <code className="font-mono">/artifacts</code>.
          </p>
        )}
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {artifacts.map((artifact, index) => (
            <li key={index}>
              <div
                className={cn(
                  'group flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                  index === selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <FileCode className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono">{artifact.path}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${artifact.path}`}
                  onClick={() => {
                    onChange(artifacts.filter((_, i) => i !== index));
                    setSelected((previous) => (previous >= index ? Math.max(0, previous - 1) : previous));
                  }}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {adding ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newPath}
              placeholder="scripts/poll.py"
              aria-label="New file path"
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFile();
                if (e.key === 'Escape') {
                  setNewPath('');
                  setAdding(false);
                }
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
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 self-start rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            Add file
          </button>
        )}

        <p className="mt-1 text-[11px] text-muted-foreground">
          {formatBytes(used)} of {formatBytes(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES)} used
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {current === undefined ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            Select a file to edit it
          </div>
        ) : (
          <>
            <input
              value={current.path}
              aria-label="File path"
              onChange={(e) =>
                onChange(artifacts.map((artifact, i) => (i === selected ? { ...artifact, path: e.target.value } : artifact)))
              }
              className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CodeEditor
                value={current.contents}
                language="text"
                onChange={(contents) =>
                  onChange(artifacts.map((artifact, i) => (i === selected ? { ...artifact, contents } : artifact)))
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Inside a run this file is <code className="font-mono">/artifacts/{current.path}</code>.
            </p>
          </>
        )}
        {issue !== null && <p className="text-xs text-destructive">{issue}</p>}
      </div>
    </div>
  );
}
