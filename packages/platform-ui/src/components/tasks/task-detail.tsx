'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Lock, FileText, CheckCircle, Download, Loader2 } from 'lucide-react';
import { where, orderBy } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';
import { ClaimButton, UnclaimButton } from './claim-button';
import { TaskContextPanel } from './task-context-panel';
import { AgentOutputReviewPanel } from './agent-output-review-panel';
import { FileUploadZone } from './file-upload-zone';
import { VerdictForm, VerdictConfirmationReadOnly } from './verdict-form';
import { ParamsForm, ParamsConfirmationReadOnly } from './params-form';
import { SelectionForm, SelectionConfirmationReadOnly } from './selection-form';
import { NextStepCard } from './next-step-card';
import { getTaskDisplayTitle, isAgentReviewTask, getAgentOutput, getAgentOutputFromSiblings } from './task-utils';
import { completeUploadTask } from '@/app/actions/tasks';
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

function formatUploadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
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
  const [uploadProgress, setUploadProgress] = React.useState<{ completed: number; total: number; bytes: number; totalBytes: number }>({ completed: 0, total: 0, bytes: 0, totalBytes: 0 });

  const onContentLoaded = React.useCallback((has: boolean) => {
    setHasStepContent(has);
  }, []);

  const isFileUploadTask = task.ui?.component === 'file-upload';
  const isSelectionTask = Array.isArray(task.options) && task.options.length > 0;
  const isParamsTask = Array.isArray(task.params) && task.params.length > 0;

  const handleFileUpload = React.useCallback(async (files: File[]) => {
    setUploadError(null);
    setUploading(true);

    try {
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      setUploadProgress({ completed: 0, total: files.length, bytes: 0, totalBytes });

      // Upload files sequentially to get accurate per-file progress
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
          type: file.type,
          storagePath,
          downloadUrl,
        });
      }

      // Complete the task with file metadata
      const result = await completeUploadTask(task.id, uploadedFiles);
      if (result.success) {
        setUploadComplete(true);
      } else {
        setUploadError(result.error ?? 'Upload failed');
      }
    } catch (err) {
      const fileIndex = uploadProgress.completed;
      const failedFileName = fileIndex < files.length ? files[fileIndex].name : 'unknown';
      const baseMessage = err instanceof Error ? err.message : 'Upload to storage failed';
      setUploadError(`Failed to upload "${failedFileName}": ${baseMessage}`);
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

  // All tasks for the same process run
  const siblingConstraints = useMemo(
    () => [
      where('processInstanceId', '==', task.processInstanceId),
      orderBy('createdAt', 'asc'),
    ],
    [task.processInstanceId],
  );
  const { data: siblingTasks } = useCollection<HumanTask>(
    'humanTasks',
    siblingConstraints,
  );

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
            {getTaskDisplayTitle(task, processInstance)}
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
              href={`/workflows/${encodeURIComponent(processInstance.definitionName)}/runs/${task.processInstanceId}`}
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

      {/* Quick claim — visible at the top so users don't need to scroll */}
      {isPending && (
        <ClaimButton taskId={task.id} currentUserId={currentUserId} fullWidth />
      )}

      {/* All tasks in this run */}
      {siblingTasks.length > 1 && (
        <div className="rounded-lg border p-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            All Tasks in This Run
          </div>
          <div className="space-y-1.5">
            {siblingTasks.map((sibling) => {
              const isCurrent = sibling.id === task.id;
              return (
                <div
                  key={sibling.id}
                  className={cn(
                    'flex items-center gap-2 text-sm rounded-md px-2 py-1.5',
                    isCurrent && 'bg-primary/5 border border-primary/10',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      STATUS_STYLES[sibling.status] ?? STATUS_STYLES.pending,
                    )}
                  >
                    {sibling.status}
                  </span>
                  {isCurrent ? (
                    <span className="font-medium truncate">
                      {getTaskDisplayTitle(sibling, processInstance)}
                    </span>
                  ) : (
                    <Link
                      href={`/tasks/${sibling.id}`}
                      className="text-primary hover:underline truncate"
                    >
                      {getTaskDisplayTitle(sibling, processInstance)}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent output review panel — for L3 agent review tasks */}
      <AgentOutputSection
        task={task}
        processInstance={processInstance}
        siblingTasks={siblingTasks}
        onContentLoaded={onContentLoaded}
      />

      {/* Previous step output — context for all non-file-upload tasks */}
      {!isFileUploadTask && (
        <TaskContextPanel
          processInstanceId={task.processInstanceId}
          stepId={task.stepId}
          onContentLoaded={isAgentReviewTask(task, processInstance) ? undefined : onContentLoaded}
        />
      )}

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
                  {formatUploadSize(uploadProgress.bytes)} / {formatUploadSize(uploadProgress.totalBytes)}
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

        {isClaimedByMe && !isFileUploadTask && isSelectionTask && (
          <>
            <SelectionForm
              taskId={task.id}
              options={task.options!}
              remainingTaskCount={remainingTaskCount}
            />
            <div className="pt-1 border-t">
              <UnclaimButton taskId={task.id} currentUserId={currentUserId} />
            </div>
          </>
        )}

        {isClaimedByMe && !isFileUploadTask && !isSelectionTask && isParamsTask && (
          <>
            <ParamsForm
              taskId={task.id}
              params={task.params!}
              remainingTaskCount={remainingTaskCount}
            />
            <div className="pt-1 border-t">
              <UnclaimButton taskId={task.id} currentUserId={currentUserId} />
            </div>
          </>
        )}

        {isClaimedByMe && !isFileUploadTask && !isSelectionTask && !isParamsTask && (
          <>
            <VerdictForm
              taskId={task.id}
              disabled={false}
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
        {isCompleted && task.completionData && !isFileUploadTask && isSelectionTask && (
          <SelectionConfirmationReadOnly
            completionData={task.completionData}
            remainingTaskCount={remainingTaskCount}
          />
        )}
        {isCompleted && task.completionData && !isFileUploadTask && !isSelectionTask && isParamsTask && (
          <ParamsConfirmationReadOnly
            completionData={task.completionData}
            params={task.params!}
          />
        )}
        {isCompleted && task.completionData && !isFileUploadTask && !isSelectionTask && !isParamsTask && (
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

// --- Agent output section — resolves agent output from task or siblings ---

function AgentOutputSection({
  task,
  processInstance,
  siblingTasks,
  onContentLoaded,
}: {
  task: HumanTask;
  processInstance: ProcessInstance | null;
  siblingTasks: HumanTask[];
  onContentLoaded: (has: boolean) => void;
}) {
  const isAgentReview = isAgentReviewTask(task, processInstance);
  if (!isAgentReview) return null;

  // Try this task's completionData first, then check sibling tasks
  const agentOutput = getAgentOutput(task) ?? getAgentOutputFromSiblings(task, siblingTasks);

  if (!agentOutput) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Agent output pending — the agent completed but output data is not yet available on this task.
        </p>
      </div>
    );
  }

  return (
    <AgentOutputReviewPanel
      agentOutput={agentOutput}
      stepId={task.stepId}
      onContentLoaded={onContentLoaded}
    />
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
