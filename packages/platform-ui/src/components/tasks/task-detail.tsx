'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Lock, FileText, CheckCircle, Download, Loader2 } from 'lucide-react';
import { where, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { HumanTask } from '@mediforce/platform-core';
import { ClaimButton, UnclaimButton } from './claim-button';
import { TaskContextPanel } from './task-context-panel';
import { FileUploadZone } from './file-upload-zone';
import { VerdictForm, VerdictConfirmationReadOnly } from './verdict-form';
import { NextStepCard } from './next-step-card';
import { completeUploadTask } from '@/app/actions/upload-task';
import { useCollection } from '@/hooks/use-collection';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { storage } from '@/lib/firebase';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

/** Format a stepId into a human-readable title. */
function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TaskDetail({
  task,
  currentUserId,
}: {
  task: HumanTask;
  currentUserId: string;
}) {
  const { data: processInstance } = useProcessInstance(task.processInstanceId);
  const [hasStepContent, setHasStepContent] = React.useState(false);
  const [uploadComplete, setUploadComplete] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const onContentLoaded = React.useCallback((has: boolean) => {
    setHasStepContent(has);
  }, []);

  const isFileUploadTask = task.ui?.component === 'file-upload';

  const handleFileUpload = React.useCallback(async (files: File[]) => {
    setUploadError(null);
    setUploading(true);

    try {
      // Upload each file to Firebase Storage
      const uploadedFiles = await Promise.all(
        files.map(async (file) => {
          const storagePath = `tasks/${task.id}/${crypto.randomUUID()}_${file.name}`;
          const storageRef = ref(storage, storagePath);
          await uploadBytes(storageRef, file, { contentType: file.type });
          const downloadUrl = await getDownloadURL(storageRef);

          return {
            name: file.name,
            size: file.size,
            type: file.type,
            storagePath,
            downloadUrl,
          };
        }),
      );

      // Complete the task with file metadata
      const result = await completeUploadTask(task.id, uploadedFiles);
      if (result.success) {
        setUploadComplete(true);
      } else {
        setUploadError(result.error ?? 'Upload failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload to storage failed');
    } finally {
      setUploading(false);
    }
  }, [task.id]);

  // Count remaining tasks for the same role (pending or claimed, excluding this task)
  const remainingConstraints = useMemo(
    () =>
      task.assignedRole
        ? [
            where('assignedRole', '==', task.assignedRole),
            where('status', 'in', ['pending', 'claimed']),
            orderBy('createdAt', 'asc'),
          ]
        : [],
    [task.assignedRole],
  );
  const { data: remainingTasks } = useCollection<HumanTask>(
    'humanTasks',
    remainingConstraints,
  );
  const remainingTaskCount = remainingTasks.filter((t) => t.id !== task.id).length;

  const isClaimedByMe = task.status === 'claimed' && task.assignedUserId === currentUserId;
  const isClaimedByOther = task.status === 'claimed' && task.assignedUserId !== currentUserId;
  const isCompleted = task.status === 'completed';
  const isPending = task.status === 'pending';

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Back */}
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to My Tasks
      </Link>

      {/* Title + status */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-headline font-semibold flex-1">
            {formatStepName(task.stepId)}
          </h1>
          <span
            className={cn(
              'shrink-0 mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize',
              STATUS_STYLES[task.status] ?? STATUS_STYLES.pending,
            )}
          >
            {task.status}
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="rounded-lg border p-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Run
          </div>
          {processInstance ? (
            <Link
              href={`/processes/${encodeURIComponent(processInstance.definitionName)}/runs/${task.processInstanceId}`}
              className="text-primary hover:underline font-mono text-xs"
            >
              {task.processInstanceId.slice(0, 12)}&hellip;
            </Link>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {task.processInstanceId.slice(0, 12)}&hellip;
            </span>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Role
          </div>
          <div>{task.assignedRole}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Deadline
          </div>
          <div>
            {task.deadline ? (
              format(new Date(task.deadline), 'MMM d, yyyy HH:mm')
            ) : (
              <span>&mdash;</span>
            )}
          </div>
        </div>
        {task.assignedUserId && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Assigned To
            </div>
            <div className="font-mono text-xs">{task.assignedUserId}</div>
          </div>
        )}
        {task.completedAt && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Completed At
            </div>
            <div>{format(new Date(task.completedAt), 'MMM d, yyyy HH:mm')}</div>
          </div>
        )}
      </div>

      {/* Previous step output (context panel) */}
      <TaskContextPanel
        processInstanceId={task.processInstanceId}
        stepId={task.stepId}
        onContentLoaded={onContentLoaded}
      />

      {/* Action section — conditional on task status */}
      <div className="space-y-3">
        {/* Pending: show claim button */}
        {isPending && (
          <ClaimButton taskId={task.id} currentUserId={currentUserId} />
        )}

        {/* Claimed by current user: show upload zone OR verdict form */}
        {isClaimedByMe && isFileUploadTask && !uploadComplete && (
          <>
            {uploading ? (
              <div className="flex items-center gap-3 rounded-lg border p-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Uploading files...</span>
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
            {!uploading && (
              <div className="pt-1 border-t">
                <UnclaimButton taskId={task.id} currentUserId={currentUserId} />
              </div>
            )}
          </>
        )}

        {isClaimedByMe && isFileUploadTask && uploadComplete && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Files uploaded successfully
            </p>
          </div>
        )}

        {isClaimedByMe && !isFileUploadTask && (
          <>
            <VerdictForm
              taskId={task.id}
              disabled={!hasStepContent}
              remainingTaskCount={remainingTaskCount}
            />
            <div className="pt-1 border-t">
              <UnclaimButton taskId={task.id} currentUserId={currentUserId} />
            </div>
          </>
        )}

        {/* Claimed by another user: locked state */}
        {isClaimedByOther && (
          <div className="rounded-lg border border-dashed p-4 flex items-center gap-3">
            <Lock className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Task is locked
              </p>
              <p className="text-xs text-muted-foreground">
                Claimed by{' '}
                <span className="font-mono">{task.assignedUserId}</span>
              </p>
            </div>
          </div>
        )}

        {/* Completed: upload confirmation or verdict confirmation */}
        {isCompleted && task.completionData && isFileUploadTask && (
          <UploadConfirmationReadOnly completionData={task.completionData} />
        )}
        {isCompleted && task.completionData && !isFileUploadTask && (
          <VerdictConfirmationReadOnly
            completionData={task.completionData}
            remainingTaskCount={remainingTaskCount}
          />
        )}

        {isCompleted && (
          <NextStepCard
            processInstanceId={task.processInstanceId}
            stepId={task.stepId}
          />
        )}
      </div>
    </div>
  );
}

// --- Upload completion read-only view ---

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function UploadConfirmationReadOnly({
  completionData,
}: {
  completionData: Record<string, unknown>;
}) {
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
        <Link href="/tasks" className="text-primary hover:underline font-medium">
          Back to tasks
        </Link>
      </div>
    </div>
  );
}
