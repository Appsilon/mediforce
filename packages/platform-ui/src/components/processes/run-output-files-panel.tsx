'use client';

import * as React from 'react';
import { Download, DownloadCloud, Eye, File, FileArchive, FileImage, FileSpreadsheet, FileText, type LucideIcon } from 'lucide-react';
import type { Step } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { formatBytes, formatStepName } from '@/lib/format';
import { saveBlobToDevice } from '@/lib/save-blob';
import { selectViewer } from '@/lib/output-file-viewer';
import { extensionOf } from '@/lib/file-extension';
import { cn } from '@/lib/utils';
import { OutputFilePreview } from './output-file-preview';

export interface OutputFileGroup {
  stepId: string;
  stepName: string;
  files: RunOutputFileEntry[];
}

/**
 * Group a flat Output Files listing by step, ordered by the workflow
 * definition's step order (unknown step IDs append in first-seen order).
 * Step names resolve from the definition; missing steps fall back to a
 * title-cased step ID, matching the step labels elsewhere on the page.
 */
export function groupOutputFilesByStep(
  files: RunOutputFileEntry[],
  definitionSteps: Step[],
): OutputFileGroup[] {
  const byStepId = new Map<string, RunOutputFileEntry[]>();
  for (const file of files) {
    const existing = byStepId.get(file.stepId);
    if (existing) {
      existing.push(file);
    } else {
      byStepId.set(file.stepId, [file]);
    }
  }

  const definitionOrder = definitionSteps
    .map((step) => step.id)
    .filter((stepId) => byStepId.has(stepId));
  const unknownOrder = [...byStepId.keys()].filter(
    (stepId) => definitionSteps.some((step) => step.id === stepId) === false,
  );

  return [...definitionOrder, ...unknownOrder].map((stepId) => ({
    stepId,
    stepName:
      definitionSteps.find((step) => step.id === stepId)?.name ?? formatStepName(stepId),
    files: [...(byStepId.get(stepId) ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

const DOCUMENT_EXTENSIONS = new Set(['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'html']);
const TABLE_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'parquet']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', '7z']);

function fileTypeIcon(fileName: string): LucideIcon {
  const extension = extensionOf(fileName);
  if (DOCUMENT_EXTENSIONS.has(extension)) return FileText;
  if (TABLE_EXTENSIONS.has(extension)) return FileSpreadsheet;
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive;
  return File;
}

async function downloadOutputFile(runId: string, file: RunOutputFileEntry): Promise<void> {
  const downloaded = await mediforce.runs.downloadOutputFile({ runId, path: file.path });
  // `.slice()` re-types the view as Uint8Array<ArrayBuffer> (BlobPart
  // rejects the wider ArrayBufferLike the client returns).
  saveBlobToDevice(
    new Blob([downloaded.bytes.slice()], { type: downloaded.contentType }),
    downloaded.fileName,
  );
}

export function OutputFileRow({ runId, file }: { runId: string; file: RunOutputFileEntry }) {
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const Icon = fileTypeIcon(file.name);
  const canPreview = selectViewer(file.name, file.size).viewer !== 'download';

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadOutputFile(runId, file);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="flex items-center gap-2 text-sm min-w-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="truncate" title={file.name}>{file.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
      {downloadError && (
        <span className="text-xs text-destructive truncate">{downloadError}</span>
      )}
      {canPreview && (
        <button
          onClick={() => setPreviewOpen(true)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
        >
          <Eye className="h-3 w-3" />
          View
        </button>
      )}
      <button
        onClick={handleDownload}
        disabled={downloading}
        className={cn(
          'inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 shrink-0',
          canPreview ? '' : 'ml-auto',
        )}
      >
        <Download className="h-3 w-3" />
        {downloading ? 'Downloading...' : 'Download'}
      </button>
      {canPreview && (
        <OutputFilePreview runId={runId} file={file} open={previewOpen} onOpenChange={setPreviewOpen} />
      )}
    </li>
  );
}

/**
 * "Files" card on the run detail page — the run's Output Files grouped by
 * step. Renders nothing while the run has no output files (zero noise).
 */
export function RunOutputFilesPanel({
  runId,
  files,
  definitionSteps,
}: {
  runId: string;
  files: RunOutputFileEntry[];
  definitionSteps: Step[];
}) {
  const [downloadingAll, setDownloadingAll] = React.useState(false);
  const [downloadAllError, setDownloadAllError] = React.useState<string | null>(null);
  const groups = React.useMemo(
    () => groupOutputFilesByStep(files, definitionSteps),
    [files, definitionSteps],
  );

  if (groups.length === 0) {
    return null;
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  async function handleDownloadAll() {
    setDownloadingAll(true);
    setDownloadAllError(null);
    try {
      const archive = await mediforce.runs.downloadOutputFilesArchive({ runId });
      saveBlobToDevice(
        new Blob([archive.bytes.slice()], { type: 'application/zip' }),
        archive.fileName,
      );
    } catch (err) {
      setDownloadAllError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Files</h3>
        <div className="flex items-center gap-2 min-w-0">
          {downloadAllError && (
            <span className="text-xs text-destructive truncate">{downloadAllError}</span>
          )}
          <button
            onClick={handleDownloadAll}
            disabled={downloadingAll}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50 shrink-0"
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            {downloadingAll ? 'Downloading...' : `Download all (${formatBytes(totalSize)})`}
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.stepId}>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              {group.stepName}
            </h4>
            <ul className="space-y-1">
              {group.files.map((file) => (
                <OutputFileRow key={file.path} runId={runId} file={file} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
