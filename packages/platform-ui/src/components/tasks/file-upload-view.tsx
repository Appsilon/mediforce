'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle, FileText, Download, Loader2 } from 'lucide-react';
import type { Attachment } from '@mediforce/platform-core';
import { FileUploadZone } from './file-upload-zone';
import { mediforce } from '@/lib/mediforce';
import { downloadViaApiFetch } from '@/lib/save-blob';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import type { TaskBodyProps } from './task-body-registry';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FileUploadView({ task }: TaskBodyProps) {
  const [uploadComplete, setUploadComplete] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState({ completed: 0, total: 0 });

  const handleFileUpload = React.useCallback(async (files: File[]) => {
    setUploadError(null);
    setUploading(true);
    setUploadCount({ completed: 0, total: files.length });

    try {
      // Upload each file's bytes to the headless attachments API (ADR-0003),
      // then complete the task with the resulting descriptors. Completion still
      // writes `completion_data.files` / `stepOutput.files`, the surface
      // downstream workflow steps read — the descriptors now point at the blob
      // endpoint instead of a Firebase Storage download URL.
      const attachments: Attachment[] = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const content = new Uint8Array(await file.arrayBuffer());
        const { attachment } = await mediforce.tasks.attachments.upload({
          taskId: task.id,
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          content,
        });
        attachments.push({
          name: attachment.name,
          size: attachment.sizeBytes,
          type: attachment.contentType,
          // `storagePath` now carries the attachment id (not a blob path);
          // `downloadUrl` is the authenticated blob endpoint.
          storagePath: attachment.id,
          downloadUrl: mediforce.attachments.blobUrl(attachment.id),
        });
        setUploadCount({ completed: index + 1, total: files.length });
      }

      await mediforce.tasks.complete({
        taskId: task.id,
        payload: { kind: 'upload', attachments },
      });
      setUploadComplete(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [task.id]);

  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable && !uploadComplete) {
    return (
      <>
        {uploading ? (
          <div className="space-y-3 rounded-lg border p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                Uploading {uploadCount.completed} of {uploadCount.total} files
              </span>
            </div>
          </div>
        ) : (
          <FileUploadZone
            acceptedTypes={(task.ui?.config?.acceptedTypes as string[]) ?? ['application/pdf']}
            minFiles={(task.ui?.config?.minFiles as number) ?? 1}
            maxFiles={(task.ui?.config?.maxFiles as number) ?? 10}
            onSubmit={handleFileUpload}
          />
        )}
        {uploadError && (
          <p className="text-sm text-destructive">{uploadError}</p>
        )}
      </>
    );
  }

  if (isActionable && uploadComplete) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <p className="text-sm font-medium text-green-800 dark:text-green-300">
          Files uploaded successfully
        </p>
      </div>
    );
  }

  if (isCompleted) {
    const completedAtRaw = (task.completionData as Record<string, unknown> | null)?.completedAt;
    const completedAt = typeof completedAtRaw === 'string' ? completedAtRaw : undefined;
    return <UploadConfirmationReadOnly taskId={task.id} completedAt={completedAt} />;
  }

  return null;
}

function UploadConfirmationReadOnly({
  taskId,
  completedAt,
}: {
  taskId: string;
  completedAt?: string;
}) {
  const handle = useHandleFromPath();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['task-attachments', taskId],
    queryFn: () => mediforce.tasks.attachments.list({ taskId }),
  });
  const attachments = data?.attachments ?? [];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            {isLoading
              ? 'Loading files…'
              : `${attachments.length} file${attachments.length !== 1 ? 's' : ''} uploaded`}
          </span>
        </div>

        {isError && (
          <p className="text-sm text-destructive">Failed to load attachments</p>
        )}

        <ul className="space-y-2">
          {attachments.map((attachment) => (
            <AttachmentRow key={attachment.id} attachment={attachment} />
          ))}
        </ul>

        {completedAt && (
          <p className="mt-2 text-xs text-green-600/70 dark:text-green-400/70">
            {format(new Date(completedAt), 'MMM d, yyyy HH:mm')}
          </p>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        <Link href={`/${handle}/tasks`} className="text-primary hover:underline font-medium">
          Back to tasks
        </Link>
      </div>
    </div>
  );
}

function AttachmentRow({
  attachment,
}: {
  attachment: { id: string; name: string; sizeBytes: number };
}) {
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      // Fetch through `apiFetch` and hand the browser a transient object URL,
      // so a non-200 from the blob route surfaces as an error instead of a
      // broken download — same pattern as run Output Files.
      await downloadViaApiFetch(mediforce.attachments.blobUrl(attachment.id), attachment.name);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{attachment.name}</span>
      <span className="text-xs text-green-600/70 dark:text-green-400/70 shrink-0">
        {formatFileSize(attachment.sizeBytes)}
      </span>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-label={`Download ${attachment.name}`}
        className="shrink-0 text-green-600 hover:text-green-800 disabled:opacity-50 dark:text-green-400 dark:hover:text-green-200"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>
      {downloadError && (
        <span className="text-xs text-destructive truncate">{downloadError}</span>
      )}
    </li>
  );
}
