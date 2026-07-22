'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Papa from 'papaparse';
import { Download, Loader2, Maximize2, Minimize2, X } from 'lucide-react';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format';
import { saveBlobToDevice } from '@/lib/save-blob';
import {
  selectViewer,
  CSV_PREVIEW_ROW_LIMIT,
  TEXT_PREVIEW_MAX_BYTES,
  type ViewerSelection,
} from '@/lib/output-file-viewer';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { SandboxedHtmlIframe } from '@/components/tasks/sandboxed-html-iframe';

interface OutputFilePreviewProps {
  runId: string;
  file: RunOutputFileEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Fetched file bytes, decoded lazily per-viewer. */
interface LoadedFile {
  bytes: Uint8Array;
  contentType: string;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; file: LoadedFile }
  | { kind: 'error'; message: string };

/**
 * Modal preview of one Output File. Renders the file in-browser via the
 * viewer that {@link selectViewer} picks from the name + size, falling back
 * to a download prompt for unsupported or oversized files. The bytes come
 * from `mediforce.runs.downloadOutputFile` — the same authenticated,
 * workspace-scoped route the download button uses; nothing renders the file
 * by navigating the browser at it directly.
 */
export function OutputFilePreview({ runId, file, open, onOpenChange }: OutputFilePreviewProps) {
  const selection = React.useMemo<ViewerSelection>(
    () => selectViewer(file.name, file.size),
    [file.name, file.size],
  );
  const previewable = selection.viewer !== 'download';

  const [state, setState] = React.useState<LoadState>({ kind: 'idle' });
  const [downloading, setDownloading] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);

  // Reopen windowed: a maximized preview from a previous file shouldn't carry
  // over when the dialog closes.
  React.useEffect(() => {
    if (open === false) setFullscreen(false);
  }, [open]);

  React.useEffect(() => {
    if (open === false || previewable === false) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    mediforce.runs
      .downloadOutputFile({ runId, path: file.path })
      .then((downloaded) => {
        if (cancelled) return;
        setState({
          kind: 'loaded',
          file: { bytes: downloaded.bytes, contentType: downloaded.contentType },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load file' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, previewable, runId, file.path]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const downloaded = await mediforce.runs.downloadOutputFile({ runId, path: file.path });
      saveBlobToDevice(
        new Blob([downloaded.bytes.slice()], { type: downloaded.contentType }),
        downloaded.fileName,
      );
    } catch {
      // The inline download button is a convenience; the row's own download
      // surfaces errors. Swallow here to avoid a second error channel.
    } finally {
      setDownloading(false);
    }
  }

  const shortName = file.name.split('/').pop() ?? file.name;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-background shadow-lg focus:outline-none',
            fullscreen
              ? 'inset-0 h-full w-full rounded-none border-0'
              : 'left-1/2 top-1/2 max-h-[85vh] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-lg border',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold" title={file.name}>
                {shortName}
              </Dialog.Title>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {downloading ? 'Downloading…' : 'Download'}
              </button>
              {previewable && (
                <button
                  onClick={() => setFullscreen((prev) => !prev)}
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              )}
              <Dialog.Close asChild>
                <button
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">Preview of output file {shortName}</Dialog.Description>

          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
            <PreviewBody selection={selection} state={state} fileName={shortName} fill={fullscreen} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreviewBody({
  selection,
  state,
  fileName,
  fill,
}: {
  selection: ViewerSelection;
  state: LoadState;
  fileName: string;
  fill: boolean;
}) {
  if (selection.viewer === 'download') {
    const message =
      selection.reason === 'too-large'
        ? `File is too large to preview (over ${formatBytes(TEXT_PREVIEW_MAX_BYTES)}). Download it to view the full contents.`
        : 'This file type cannot be previewed in the browser. Download it to open in another application.';
    return <Notice>{message}</Notice>;
  }

  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading preview…</span>
      </div>
    );
  }

  if (state.kind === 'error') {
    return <Notice tone="error">{state.message}</Notice>;
  }

  return <RenderedFile viewer={selection.viewer} file={state.file} fileName={fileName} fill={fill} />;
}

function RenderedFile({
  viewer,
  file,
  fileName,
  fill,
}: {
  viewer: Exclude<ViewerSelection['viewer'], 'download'>;
  file: LoadedFile;
  fileName: string;
  fill: boolean;
}) {
  // Blob-backed viewers (image, svg-as-image, pdf) hand a same-origin blob URL
  // to the browser, which streams it natively. Kept in state so it can be
  // revoked on unmount.
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const isBlobViewer = viewer === 'image' || viewer === 'svg' || viewer === 'pdf';

  React.useEffect(() => {
    if (isBlobViewer === false) return;
    // `.slice()` re-types the view as Uint8Array<ArrayBuffer> — BlobPart
    // rejects the wider ArrayBufferLike the client returns (same as the panel).
    const url = URL.createObjectURL(new Blob([file.bytes.slice()], { type: file.contentType }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isBlobViewer, file]);

  const text = React.useMemo(() => {
    if (isBlobViewer) return '';
    return new TextDecoder().decode(file.bytes);
  }, [isBlobViewer, file]);

  switch (viewer) {
    case 'markdown':
      return <MarkdownPresentation content={text} />;
    case 'html':
      return <SandboxedHtmlIframe html={text} title={`Preview of ${fileName}`} fill={fill} />;
    case 'text':
      return (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs leading-relaxed">
          {text}
        </pre>
      );
    case 'csv':
      return <CsvTable text={text} />;
    case 'image':
    case 'svg':
      // eslint-disable-next-line @next/next/no-img-element -- blob URL, not a static asset; SVG rendered as <img> deliberately (image context cannot execute embedded scripts).
      return blobUrl ? <img src={blobUrl} alt={fileName} className="mx-auto max-w-full" /> : null;
    case 'pdf':
      return blobUrl ? (
        <iframe src={blobUrl} title={`Preview of ${fileName}`} className="h-[70vh] w-full border-0" />
      ) : null;
  }
}

function CsvTable({ text }: { text: string }) {
  const parsed = React.useMemo(() => Papa.parse<string[]>(text, { skipEmptyLines: true }), [text]);
  const rows = parsed.data;

  if (rows.length === 0) {
    return <Notice>Empty file — no rows to show.</Notice>;
  }

  const [header, ...body] = rows;
  const shown = body.slice(0, CSV_PREVIEW_ROW_LIMIT);
  const hiddenCount = body.length - shown.length;

  return (
    <div>
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted">
              {header.map((cell, i) => (
                <th key={i} className="border-b px-2 py-1 text-left font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="odd:bg-muted/30">
                {header.map((_, c) => (
                  <td key={c} className="border-b px-2 py-1 align-top">
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing first {CSV_PREVIEW_ROW_LIMIT} of {body.length} rows — download for the full file.
        </p>
      )}
    </div>
  );
}

function Notice({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div
      className={cn(
        'rounded-md border p-4 text-sm',
        tone === 'error'
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}
