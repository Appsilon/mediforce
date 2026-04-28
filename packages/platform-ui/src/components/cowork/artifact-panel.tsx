'use client';

import * as React from 'react';
import {
  Loader2, CheckCircle, Lock, Check, Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Artifact requirements validation
// ---------------------------------------------------------------------------

function getRequiredFields(outputSchema: Record<string, unknown> | null): string[] {
  if (!outputSchema) return [];
  const required = outputSchema.required;
  if (Array.isArray(required)) return required as string[];
  return [];
}

function checkRequiredFields(
  artifact: Record<string, unknown> | null,
  requiredFields: string[],
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const field of requiredFields) {
    const value = artifact?.[field];
    const present = value !== undefined && value !== null &&
      !(Array.isArray(value) && value.length === 0) &&
      !(typeof value === 'string' && value.trim().length === 0);
    result.set(field, present);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Artifact preview panel
// ---------------------------------------------------------------------------

interface ArtifactPanelProps {
  artifact: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  onFinalize: () => void;
  finalizing: boolean;
  finalized: boolean;
}

export function ArtifactPanel({
  artifact,
  outputSchema,
  onFinalize,
  finalizing,
  finalized,
}: ArtifactPanelProps) {
  const requiredFields = React.useMemo(() => getRequiredFields(outputSchema), [outputSchema]);
  const fieldStatus = React.useMemo(
    () => checkRequiredFields(artifact, requiredFields),
    [artifact, requiredFields],
  );
  const fulfilledCount = [...fieldStatus.values()].filter(Boolean).length;
  const allFulfilled = requiredFields.length === 0 || fulfilledCount === requiredFields.length;

  return (
    <div className={cn(
      'flex h-full flex-col rounded-lg border transition-colors',
      finalized && 'border-green-300 dark:border-green-800',
    )}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Artifact</h3>
        {artifact && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            finalized
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
          )}>
            {finalized ? <Lock className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
            {finalized ? 'Finalized' : 'Draft'}
          </span>
        )}
      </div>

      {/* Requirements checklist */}
      {requiredFields.length > 0 && !finalized && (
        <div className="border-b px-4 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Required fields</span>
            <span className={cn(
              'text-xs font-mono',
              allFulfilled ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
            )}>
              {fulfilledCount}/{requiredFields.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {requiredFields.map((field) => {
              const present = fieldStatus.get(field) === true;
              return (
                <span
                  key={field}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                    present
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {present ? <Check className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
                  {field}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className={cn('flex-1 overflow-auto p-4', finalized && 'opacity-80')}>
        {artifact ? (
          <pre className="rounded-md bg-muted p-3 text-xs overflow-auto whitespace-pre-wrap break-words font-mono">
            {JSON.stringify(artifact, null, 2)}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No artifact yet. Start a conversation to build one.
          </div>
        )}
      </div>

      {!finalized && (
        <div className="border-t p-4">
          <button
            onClick={onFinalize}
            disabled={!artifact || !allFulfilled || finalizing}
            className={cn(
              'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
              artifact && allFulfilled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {finalizing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Finalizing...
              </span>
            ) : (
              'Finalize Artifact'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
