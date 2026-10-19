'use client';

import * as React from 'react';
import { Download, Maximize2 } from 'lucide-react';
import type { InstanceStatus } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { useRunOutputFiles } from '@/hooks/use-run-output-files';
import { OutputFileContent, OutputFilePreview, downloadOutputFile } from '@/components/processes/output-file-preview';
import { JsonDataView } from '@/components/processes/json-data-view';
import { selectViewer } from '@/lib/output-file-viewer';
import { formatBytes } from '@/lib/format';
import { saveBlobToDevice } from '@/lib/save-blob';

const RESULT_FILE_NAME = 'result.json';

interface StepOutputViewerProps {
  /** The step result (`envelope.result`), rendered as `result.json`. */
  result: Record<string, unknown> | null;
  /** The run whose branch holds the step's Output Files; null when there is no run branch. */
  runId: string | null;
  stepId: string | null;
  /** Gates the file-list polling; undefined is treated as non-terminal. */
  runStatus: InstanceStatus | undefined;
}

/**
 * One viewer per step (ADR-0030 decision 7): a dropdown that opens on
 * `result.json`, followed by every Output File the step committed to the run
 * branch. `result.json` renders from the envelope, so runs that predate the
 * committed file still show it. A step that wrote no `result.json` (a failed
 * run) still lists its committed Output Files. Every entry can be downloaded.
 */
export function StepOutputViewer({ result, runId, stepId, runStatus }: StepOutputViewerProps) {
  const { data: runFiles } = useRunOutputFiles(stepId === null ? null : runId, runStatus);
  const files = React.useMemo(
    () => runFiles
      .filter((file) => file.stepId === stepId && file.name !== RESULT_FILE_NAME)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [runFiles, stepId],
  );

  const [selectedPath, setSelectedPath] = React.useState<string>(RESULT_FILE_NAME);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      if (selectedFile !== null && runId !== null) {
        await downloadOutputFile(runId, selectedFile);
      } else {
        saveBlobToDevice(
          new Blob([`${JSON.stringify(result, null, 2)}\n`], { type: 'application/json' }),
          RESULT_FILE_NAME,
        );
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <select
          value={selectedFile === null ? RESULT_FILE_NAME : selectedFile.path}
          onChange={(event) => {
            setSelectedPath(event.target.value);
            setDownloadError(null);
          }}
          aria-label="Step output file"
          className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1 font-mono text-xs"
        >
          <option value={RESULT_FILE_NAME}>{RESULT_FILE_NAME}</option>
          {files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.name} ({formatBytes(file.size)})
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          {downloadError !== null && (
            <span className="truncate text-xs text-destructive">{downloadError}</span>
          )}
          {(selectedFile !== null || result !== null) && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          )}
          {selectedFile !== null && runId !== null && isPreviewable(selectedFile) && (
            <button
              onClick={() => setPreviewOpen(true)}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Open in a larger view"
              title="Open in a larger view"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[600px] overflow-auto p-4">
        {selectedFile === null || runId === null ? (
          <div data-testid="step-result-json">
            {result === null ? (
              <p className="text-xs italic text-muted-foreground">No result.json produced</p>
            ) : (
              <JsonDataView value={result} />
            )}
          </div>
        ) : (
          <OutputFileContent key={selectedFile.path} runId={runId} file={selectedFile} result={result} />
        )}
      </div>

      {selectedFile !== null && runId !== null && (
        <OutputFilePreview
          runId={runId}
          file={selectedFile}
          result={result}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </div>
  );
}

function isPreviewable(file: RunOutputFileEntry): boolean {
  return selectViewer(file.name, file.size).viewer !== 'download';
}
