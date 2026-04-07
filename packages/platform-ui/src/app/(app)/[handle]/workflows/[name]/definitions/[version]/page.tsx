'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Save, HelpCircle } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowEditorCanvas } from '@/components/workflows/workflow-editor-canvas';
import { saveWorkflowDefinition, type ValidationIssue } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; version: number }
  | { status: 'error'; message: string };

function parseStepErrors(
  issues: ValidationIssue[],
  steps: WorkflowStep[],
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const issue of issues) {
    if (issue.path[0] === 'steps' && typeof issue.path[1] === 'number') {
      const step = steps[issue.path[1]];
      const field = String(issue.path[2] ?? 'unknown');
      const key = step?.id || `__index_${issue.path[1]}`;
      result[key] = { ...(result[key] ?? {}), [field]: issue.message };
    }
  }
  return result;
}

export default function WorkflowDefinitionVersionPage() {
  const { name, version, handle } = useParams<{ name: string; version: string; handle: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);
  const versionNumber = parseInt(version, 10);

  const { definitions, loading } = useWorkflowDefinitions(decodedName);
  const definition = definitions.find((def) => def.version === versionNumber) ?? null;

  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [stepErrors, setStepErrors] = useState<Record<string, Record<string, string>>>({});

  // Track current canvas state so the header button can trigger save
  const currentStepsRef = useRef<WorkflowStep[]>([]);
  const currentTransitionsRef = useRef<WorkflowDefinition['transitions']>([]);

  // Sync editable fields and canvas refs from definition once loaded
  useEffect(() => {
    if (!definition) return;
    setEditedDescription(definition.description ?? '');
    currentStepsRef.current = definition.steps;
    currentTransitionsRef.current = definition.transitions;
  }, [definition?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCanvasChange = useCallback(
    (steps: WorkflowStep[], transitions: WorkflowDefinition['transitions']) => {
      currentStepsRef.current = steps;
      currentTransitionsRef.current = transitions;
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!definition) return;
    const steps = currentStepsRef.current;
    const transitions = currentTransitionsRef.current;

    const missingPlugin = steps.filter(
      (s) => s.type !== 'terminal' && (s.executor === 'agent' || s.executor === 'script') && !s.plugin,
    );
    if (missingPlugin.length > 0) {
      setSaveState({ status: 'error', message: `Plugin required for agent/script steps: ${missingPlugin.map((s) => `"${s.name}"`).join(', ')}` });
      return;
    }

    const emptyIds = steps.filter((s) => !s.id);
    if (emptyIds.length > 0) {
      setSaveState({ status: 'error', message: `Step ID is empty for: ${emptyIds.map((s) => `"${s.name}"`).join(', ')}` });
      return;
    }

    const idCounts = new Map<string, number>();
    for (const s of steps) idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
    const dupes = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    if (dupes.length > 0) {
      setSaveState({ status: 'error', message: `Duplicate step IDs: ${dupes.join(', ')}` });
      return;
    }

    setStepErrors({});
    setSaveState({ status: 'saving' });

    const mergedTransitions = [...transitions];
    for (const step of steps) {
      if (step.type === 'review' && step.verdicts) {
        for (const verdict of Object.values(step.verdicts)) {
          if (verdict.target && !mergedTransitions.some((t) => t.from === step.id && t.to === verdict.target)) {
            mergedTransitions.push({ from: step.id, to: verdict.target });
          }
        }
      }
    }

    const result = await saveWorkflowDefinition({
      name: definition.name,
      namespace: definition.namespace,
      title: editedTitle.trim() || undefined,
      description: editedDescription.trim() || undefined,
      steps,
      transitions: mergedTransitions,
      triggers: definition.triggers,
      roles: definition.roles,
      env: definition.env,
      notifications: definition.notifications,
      metadata: definition.metadata,
      repo: definition.repo,
      url: definition.url,
    });

    if (result.success) {
      setSaveState({ status: 'saved', version: result.version });
      setTimeout(() => {
        router.push(`/${handle}/workflows/${name}/definitions/${result.version}`);
      }, 500);
    } else {
      const parsed = parseStepErrors(result.issues ?? [], steps);
      setStepErrors(parsed);
      setSaveState({
        status: 'error',
        message: Object.keys(parsed).length > 0
          ? 'Some steps have errors — check the highlighted steps in the diagram.'
          : result.error,
      });
    }
  }, [definition, editedTitle, editedDescription, name, handle, router]);


  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (!loading && definition === null) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Definition v{version} for &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link href={routes.workflow(handle, decodedName)} className="underline">Back to workflow</Link>
      </div>
    );
  }

  if (definition === null) return null;

  return (
    <div className="flex flex-1 flex-col relative">
      {/* Header */}
      <div className="border-b px-6 py-4 sticky top-0 z-30 bg-background">
        <div className="flex flex-wrap items-end gap-4">
          {/* Namespace */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Namespace</label>
            <input
              value={definition.namespace ?? ''}
              disabled
              className="rounded-md border bg-muted px-3 py-1.5 text-sm outline-none text-muted-foreground cursor-not-allowed"
            />
          </div>

          {/* Workflow ID */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Workflow ID</label>
            <input
              value={decodedName}
              disabled
              className="rounded-md border bg-muted px-3 py-1.5 text-sm font-mono outline-none text-muted-foreground cursor-not-allowed min-w-48"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              placeholder="What does this workflow do?"
              className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring"
            />
          </div>

          {/* Version name */}
          <div className="flex flex-col gap-1 min-w-48">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              Version name
              <span className="group relative inline-flex">
                <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[480px] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed">
                  Workflows evolve over time — each saved revision gets a version number automatically. A version name lets you describe what changed so it&apos;s easy to tell &quot;Added AI review step&quot; apart from &quot;Tightened approval criteria&quot; at a glance, rather than deciphering v1, v2, v3.
                </span>
              </span>
            </label>
            <input
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              placeholder="e.g. Added automated review step"
              className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring"
            />
          </div>

          {/* Save button */}
          <div className="flex flex-col gap-1">
            <div className="h-[18px]" />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saveState.status === 'saving' || !editedTitle.trim()}
                title={!editedTitle.trim() ? 'Enter a version name to save' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                  (saveState.status === 'saving' || !editedTitle.trim()) && 'opacity-50 cursor-not-allowed',
                )}
              >
                <Save className="h-3.5 w-3.5" />
                {saveState.status === 'saving' ? 'Saving...' : 'Save new version'}
              </button>
              {!editedTitle.trim() && saveState.status !== 'saving' && (
                <span className="text-xs text-muted-foreground">Version name required</span>
              )}
              {saveState.status === 'saved' && (
                <span className="inline-flex items-center rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                  Saved as v{saveState.version}
                </span>
              )}
              {saveState.status === 'error' && (
                <span className="inline-flex items-center rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                  {saveState.message}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Editor canvas — key resets internal state when navigating to a different version */}
      <WorkflowEditorCanvas
        key={definition.version}
        initialSteps={definition.steps}
        initialTransitions={definition.transitions}
        workflowName={decodedName}
        yamlFields={{ ...definition, version: undefined, createdAt: undefined } as Record<string, unknown>}
        onChange={handleCanvasChange}
        stepErrors={stepErrors}
      />
    </div>
  );
}
