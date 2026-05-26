'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle, FileText, Download, Loader2 } from 'lucide-react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { FileUploadZone } from './file-upload-zone';
import { mediforce } from '@/lib/mediforce';
import { storage } from '@/lib/firebase';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import type { TaskBodyProps } from './task-body-registry';

interface UploadProgress {
  completed: number;
  total: number;
  bytes: number;
  totalBytes: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FileUploadView({ task }: TaskBodyProps) {
  const [uploadComplete, setUploadComplete] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<UploadProgress>({
    completed: 0, total: 0, bytes: 0, totalBytes: 0,
  });

  const handleFileUpload = React.useCallback(async (files: File[]) => {
    setUploadError(null);
    setUploading(true);

    try {
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      setUploadProgress({ completed: 0, total: files.length, bytes: 0, totalBytes });

      const uploadedFiles: { name: string; size: number; type: string; storagePath: string; downloadUrl: string }[] = [];
      let bytesCompletedPrevious = 0;

      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const storagePath = `tasks/${task.id}/${crypto.randomUUID()}_${file.name}`;
        const storageRef = ref(storage, storagePath);

        const downloadUrl = await new Promise<string>((resolve, reject) => {
          const uploadTask = uploadBytesResumable(storageRef, file, { contentType: file.type || 'application/octet-stream' });
          uploadTask.on('state_changed',
            (snapshot) => {
              setUploadProgress((prev) => ({
                ...prev,
                bytes: bytesCompletedPrevious + snapshot.bytesTransferred,
              }));
            },
            reject,
            async () => {
              try {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(url);
              } catch (err) {
                reject(err);
              }
            },
          );
        });

        bytesCompletedPrevious += file.size;
        setUploadProgress((prev) => ({ ...prev, completed: index + 1, bytes: bytesCompletedPrevious }));

        uploadedFiles.push({
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          storagePath,
          downloadUrl,
        });
      }

      try {
        await mediforce.tasks.complete({
          taskId: task.id,
          payload: { kind: 'upload', attachments: uploadedFiles },
        });
        setUploadComplete(true);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      }
    } catch (err) {
      const fileIndex = uploadProgress.completed;
      const failedFileName = fileIndex < files.length ? files[fileIndex].name : 'unknown';
      const baseMessage = err instanceof Error ? err.message : 'Upload to storage failed';
      setUploadError(`Failed to upload "${failedFileName}": ${baseMessage}`);
    } finally {
      setUploading(false);
    }
  }, [task.id, uploadProgress.completed]);

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
                Uploading {uploadProgress.completed} of {uploadProgress.total} files
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: uploadProgress.totalBytes > 0 ? `${Math.round((uploadProgress.bytes / uploadProgress.totalBytes) * 100)}%` : '0%' }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(uploadProgress.bytes)} / {formatFileSize(uploadProgress.totalBytes)}
            </p>
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

  if (isCompleted && task.completionData) {
    return <UploadConfirmationReadOnly completionData={task.completionData} />;
  }

  return null;
}

function UploadConfirmationReadOnly({
  completionData,
}: {
  completionData: Record<string, unknown>;
}) {
  const handle = useHandleFromPath();
  interface UploadedFile {
    name?: string;
    size?: number;
    type?: string;
    storagePath?: string;
    downloadUrl?: string;
  }
  const files = (completionData.files as UploadedFile[]) ?? [];
  const completedAt = completionData.completedAt as string | undefined;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            {files.length} file{files.length !== 1 ? 's' : ''} uploaded
          </span>
        </div>

        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={index}
              className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300"
            >
              <FileText className="h-4 w-4 shrink-0" />
              {file.downloadUrl ? (
                <a
                  href={file.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:underline"
                >
                  {file.name ?? 'unknown'}
                </a>
              ) : (
                <span className="truncate">{file.name ?? 'unknown'}</span>
              )}
              {file.size !== undefined && (
                <span className="text-xs text-green-600/70 dark:text-green-400/70 shrink-0">
                  {formatFileSize(file.size)}
                </span>
              )}
              {file.downloadUrl && (
                <a
                  href={file.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                  aria-label={`Download ${file.name ?? 'file'}`}
                >
                  <Download className="h-4 w-4" />
                </a>
              )}
            </li>
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
