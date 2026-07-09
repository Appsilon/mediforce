'use client';

import * as React from 'react';
import {
  Loader2, CheckCircle, Lock, Check, Circle, AlertCircle, ChevronRight, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// JSON tree explorer
// ---------------------------------------------------------------------------

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === 'boolean') return <span className="text-blue-600 dark:text-blue-400">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-emerald-600 dark:text-emerald-400">{value}</span>;
  if (typeof value === 'string') {
    if (value.length > 120) {
      return <span className="text-amber-700 dark:text-amber-300" title={value}>&quot;{value.slice(0, 120)}…&quot;</span>;
    }
    return <span className="text-amber-700 dark:text-amber-300">&quot;{value}&quot;</span>;
  }
  if (Array.isArray(value)) return <JsonArray items={value} depth={depth} />;
  if (typeof value === 'object') return <JsonObject obj={value as Record<string, unknown>} depth={depth} />;
  return <span>{String(value)}</span>;
}

function JsonObject({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(obj);
  const [open, setOpen] = React.useState(depth < 2);
  if (entries.length === 0) return <span className="text-muted-foreground">{'{}'}</span>;

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-xs">{`{${entries.length}}`}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-muted pl-2">
          {entries.map(([key, val]) => (
            <div key={key} className="py-0.5">
              <span className="text-violet-600 dark:text-violet-400 font-medium">{key}</span>
              <span className="text-muted-foreground">: </span>
              <JsonValue value={val} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonArray({ items, depth }: { items: unknown[]; depth: number }) {
  const [open, setOpen] = React.useState(depth < 2);
  if (items.length === 0) return <span className="text-muted-foreground">{'[]'}</span>;

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-xs">{`[${items.length}]`}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-muted pl-2">
          {items.map((item, i) => (
            <div key={i} className="py-0.5">
              <span className="text-muted-foreground text-xs mr-1">{i}</span>
              <JsonValue value={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  validationResult: { valid: boolean; errors: string[] } | null;
  presentation: string | null;
  onFinalize: () => void;
  finalizing: boolean;
  finalized: boolean;
}

export function ArtifactPanel({
  artifact,
  outputSchema,
  validationResult,
  presentation,
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

  const [activeTab, setActiveTab] = React.useState<'data' | 'preview'>('data');

  const presentationHtml = React.useMemo(() => {
    if (!presentation) return '';
    return `<!DOCTYPE html>
<html>
<head>
<script src="https://cdn.tailwindcss.com/3.4.1"></script>
<style>body { margin: 0; padding: 1rem; font-family: system-ui, sans-serif; }</style>
</head>
<body>${presentation}</body>
</html>`;
  }, [presentation]);

  React.useEffect(() => {
    if (presentation && activeTab === 'data') {
      setActiveTab('preview');
    }
  // activeTab intentionally excluded — including it would snap the user back
  // to preview every time they manually switch to the data tab.
  }, [presentation]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Validation status */}
      {validationResult && !finalized && (
        <div className={cn(
          'border-b px-4 py-2',
          validationResult.valid ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20',
        )}>
          <div className="flex items-center gap-1.5">
            {validationResult.valid ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                <span className="text-xs font-medium text-green-700 dark:text-green-400">Valid</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <span className="text-xs font-medium text-red-700 dark:text-red-400">
                  {validationResult.errors.length} error{validationResult.errors.length !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          {!validationResult.valid && validationResult.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {validationResult.errors.map((error, i) => (
                <li key={i} className="text-xs text-red-600 dark:text-red-400">
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tab bar — only show if presentation exists */}
      {presentation && !finalized && (
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('data')}
            className={cn(
              'px-4 py-2 text-xs font-medium transition-colors',
              activeTab === 'data'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Data
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'px-4 py-2 text-xs font-medium transition-colors',
              activeTab === 'preview'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Preview
          </button>
        </div>
      )}

      <div className={cn('flex-1 overflow-auto', finalized && 'opacity-80')}>
        {activeTab === 'data' || !presentation ? (
          <div className="p-4">
            {artifact ? (
              <div className="rounded-md bg-muted p-3 text-xs font-mono">
                <JsonValue value={artifact} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No artifact yet. Start a conversation to build one.
              </div>
            )}
          </div>
        ) : (
          <iframe
            srcDoc={presentationHtml}
            className="h-full w-full border-0"
            sandbox="allow-scripts"
            title="Artifact presentation"
          />
        )}
      </div>

      {!finalized && (
        <div className="border-t p-4">
          <button
            onClick={onFinalize}
            disabled={!artifact || !allFulfilled || finalizing || (validationResult !== null && !validationResult.valid)}
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
