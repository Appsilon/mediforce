'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowEditorCanvas } from '@/components/workflows/workflow-editor-canvas';
import { SaveVersionDialog } from '@/components/workflows/save-version-dialog';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
import { parseStepErrors, validateSteps, mergeVerdictTransitions } from '@/lib/workflow-save-utils';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; version: number }
  | { status: 'error'; message: string };

export default function WorkflowDefinitionVersionPage() {
  const { name, version, handle } = useParams<{ name: string; version: string; handle: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);
  const versionNumber = parseInt(version, 10);

  const { definitions, loading } = useWorkflowDefinitions(decodedName);
  const definition = definitions.find((def) => def.version === versionNumber) ?? null;

  const [editedDescription, setEditedDescription] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [stepErrors, setStepErrors] = useState<Record<string, Record<string, string>>>({});
  const [dialogOpen, setDialogOpen] = useState(false);

  // Track current canvas state so the header button can trigger save
  const currentStepsRef = useRef<WorkflowStep[]>([]);
  const currentTransitionsRef = useRef<WorkflowDefinition['transitions']>([]);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current); }, []);

  // Sync editable fields and canvas refs when the user navigates to a different
  // version. We intentionally key on version only (not the full definition object)
  // so that local edits in the canvas don't reset the description field on every
  // onChange callback — definition is rebuilt from Firestore state on each render
  // but the version number is stable while the user is on the same page.
  useEffect(() => {
    if (!definition) return;
    setEditedDescription(definition.description ?? '');
    currentStepsRef.current = definition.steps;
    currentTransitionsRef.current = definition.transitions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition?.version]);

  const handleCanvasChange = useCallback(
    (steps: WorkflowStep[], transitions: WorkflowDefinition['transitions']) => {
      currentStepsRef.current = steps;
      currentTransitionsRef.current = transitions;
    },
    [],
  );

  const handleSave = useCallback(async (title: string) => {
    if (!definition) return;
    const steps = currentStepsRef.current;
    const transitions = currentTransitionsRef.current;

    const validationError = validateSteps(steps);
    if (validationError !== null) {
      setDialogOpen(false);
      setSaveState({ status: 'error', message: validationError });
      return;
    }

    setDialogOpen(false);
    setStepErrors({});
    setSaveState({ status: 'saving' });

    const mergedTransitions = mergeVerdictTransitions(steps, transitions);

    const result = await saveWorkflowDefinition({
      name: definition.name,
      namespace: definition.namespace,
      title: title || undefined,
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
      redirectTimerRef.current = setTimeout(() => {
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
  }, [definition, editedDescription, name, handle, router]);


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
    <div className="flex h-full flex-col relative">
      {/* Header */}
      <div className="border-b px-6 py-5 sticky top-0 z-30 bg-background">
        <div className="flex items-start justify-between gap-6">
          {/* Left: workflow identity */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">
              {decodedName}
            </h1>
            <input
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              placeholder="Add a description…"
              className="mt-1 w-full bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/40 placeholder:italic border-0 outline-none px-0 py-0"
            />
            {/* Secondary metadata row */}
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground/60 flex-wrap">
              {definition.namespace && (
                <>
                  <span className="shrink-0">Namespace:</span>
                  <span className="font-mono">{definition.namespace}</span>
                  <span>·</span>
                </>
              )}
              <span className="text-muted-foreground">
                You are editing workflow version{' '}
                <span className="font-mono font-medium">v{definition.version}</span>
                {definition.title ? (
                  <> named <span className="font-medium">&ldquo;{definition.title}&rdquo;</span></>
                ) : null}
              </span>
            </div>
          </div>

          {/* Right: save controls */}
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            {saveState.status === 'saved' && (
              <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                Saved as v{saveState.version}
              </span>
            )}
            {saveState.status === 'error' && (
              <span className="text-sm text-red-600 dark:text-red-400 max-w-xs truncate" title={saveState.message}>
                {saveState.message}
              </span>
            )}
            <button
              onClick={() => setDialogOpen(true)}
              disabled={saveState.status === 'saving'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                saveState.status === 'saving' && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Save className="h-3.5 w-3.5" />
              {saveState.status === 'saving' ? 'Saving…' : 'Save new version'}
            </button>
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

      <SaveVersionDialog
        open={dialogOpen}
        nextVersion={definition.version + 1}
        confirmLabel="Save new version"
        onClose={() => setDialogOpen(false)}
        onConfirm={handleSave}
      />
    </div>
  );
}
