'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { WorkflowEditorCanvas } from '@/components/workflows/workflow-editor-canvas';
import { SaveVersionDialog } from '@/components/workflows/save-version-dialog';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
import { parseStepErrors, validateSteps, mergeVerdictTransitions } from '@/lib/workflow-save-utils';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Starter template — shown to new users as a concrete example
// ---------------------------------------------------------------------------

const TEMPLATE_STEPS: WorkflowStep[] = [
  {
    id: 'draft',
    name: 'Draft Document',
    type: 'creation',
    executor: 'human',
    description: 'A team member creates or prepares the initial content.',
  },
  {
    id: 'ai-review',
    name: 'AI Review',
    type: 'creation',
    executor: 'agent',
    plugin: 'opencode-agent',
    autonomyLevel: 'L2',
    description: 'An AI agent reviews the draft and suggests improvements.',
    agent: {
      prompt: 'Review the submitted draft for completeness, accuracy, and clarity. Return a structured assessment.',
    },
  },
  {
    id: 'done',
    name: 'Done',
    type: 'terminal',
    executor: 'human',
  },
];

const TEMPLATE_TRANSITIONS: WorkflowDefinition['transitions'] = [
  { from: 'draft', to: 'ai-review' },
  { from: 'ai-review', to: 'done' },
];

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; name: string }
  | { status: 'error'; message: string };

function toWorkflowId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function NewWorkflowPage() {
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { namespaces, loading: namespacesLoading } = useAllUserNamespaces(firebaseUser?.uid);

  const [workflowName, setWorkflowName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [description, setDescription] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [stepErrors, setStepErrors] = useState<Record<string, Record<string, string>>>({});
  const [dialogOpen, setDialogOpen] = useState(false);

  // Track current canvas state so the header button can trigger save
  const currentStepsRef = useRef<WorkflowStep[]>(TEMPLATE_STEPS);
  const currentTransitionsRef = useRef<WorkflowDefinition['transitions']>(TEMPLATE_TRANSITIONS);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current); }, []);

  const handleCanvasChange = useCallback(
    (steps: WorkflowStep[], transitions: WorkflowDefinition['transitions']) => {
      currentStepsRef.current = steps;
      currentTransitionsRef.current = transitions;
    },
    [],
  );

  // Auto-select first namespace when namespaces load
  const effectiveNamespace = namespace || namespaces[0]?.handle || '';

  const handleSave = useCallback(async (versionTitle: string) => {
    const steps = currentStepsRef.current;
    const transitions = currentTransitionsRef.current;
    const workflowId = toWorkflowId(workflowName);
    if (!workflowId) {
      setDialogOpen(false);
      setSaveState({ status: 'error', message: 'Workflow name is required.' });
      return;
    }
    if (!description.trim()) {
      setDialogOpen(false);
      setSaveState({ status: 'error', message: 'Description is required.' });
      return;
    }

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
      name: workflowId,
      namespace: effectiveNamespace || undefined,
      title: versionTitle || undefined,
      description: description.trim() || undefined,
      steps,
      transitions: mergedTransitions,
      triggers: [{ type: 'manual', name: 'start' }],
    });

    if (result.success) {
      setSaveState({ status: 'saved', name: result.name });
      redirectTimerRef.current = setTimeout(() => {
        router.push(`/${handle}/workflows/${encodeURIComponent(result.name)}/definitions/${result.version}`);
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
  }, [workflowName, effectiveNamespace, description, handle, router]);


  const yamlFields: Record<string, unknown> = {
    name: toWorkflowId(workflowName) || 'my-workflow',
    namespace: effectiveNamespace || undefined,
    description: description || undefined,
    triggers: [{ type: 'manual', name: 'start' }],
  };

  const canPublish = saveState.status !== 'saving' && !!toWorkflowId(workflowName) && !!description.trim();

  return (
    <div className="flex h-full flex-col relative">
      {/* Header */}
      <div className="border-b px-6 py-5 sticky top-0 z-30 bg-background">
        <div className="flex items-start justify-between gap-6">
          {/* Left: workflow identity */}
          <div className="flex-1 min-w-0">
            <input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Workflow name…"
              className="w-full bg-transparent text-2xl font-bold tracking-tight text-foreground placeholder:text-muted-foreground/30 border-0 outline-none px-0 py-0"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description…"
              className="mt-1 w-full bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/40 placeholder:italic border-0 outline-none px-0 py-0"
            />
            {/* Secondary metadata row */}
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground/60 flex-wrap">
              <span className="shrink-0">Namespace:</span>
              <select
                value={effectiveNamespace}
                onChange={(e) => setNamespace(e.target.value)}
                disabled={namespacesLoading || namespaces.length === 0}
                className="bg-transparent border-0 text-xs text-muted-foreground/60 outline-none cursor-pointer hover:text-muted-foreground disabled:cursor-not-allowed py-0 max-w-[160px]"
              >
                {namespacesLoading ? (
                  <option value="">Loading…</option>
                ) : (
                  namespaces.map((ns) => (
                    <option key={ns.handle} value={ns.handle}>{ns.handle}</option>
                  ))
                )}
              </select>
              {toWorkflowId(workflowName) && (
                <>
                  <span>·</span>
                  <span className="font-mono">{toWorkflowId(workflowName)}</span>
                </>
              )}
              <span>·</span>
              <span className="text-muted-foreground">You are adding a new workflow</span>
            </div>
          </div>

          {/* Right: save controls */}
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            {saveState.status === 'saved' && (
              <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                Created — redirecting…
              </span>
            )}
            {saveState.status === 'error' && (
              <span className="text-sm text-red-600 dark:text-red-400 max-w-xs truncate" title={saveState.message}>
                {saveState.message}
              </span>
            )}
            <button
              onClick={() => setDialogOpen(true)}
              disabled={!canPublish}
              title={
                !toWorkflowId(workflowName) ? 'Enter a workflow name to publish' :
                !description.trim() ? 'Add a description to publish' :
                undefined
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                !canPublish && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Save className="h-3.5 w-3.5" />
              {saveState.status === 'saving' ? 'Publishing…' : 'Publish workflow'}
            </button>
          </div>
        </div>
      </div>

      {/* Editor canvas */}
      <WorkflowEditorCanvas
        initialSteps={TEMPLATE_STEPS}
        initialTransitions={TEMPLATE_TRANSITIONS}
        yamlFields={yamlFields}
        onChange={handleCanvasChange}
        stepErrors={stepErrors}
      />

      <SaveVersionDialog
        open={dialogOpen}
        nextVersion={1}
        confirmLabel="Publish workflow"
        onClose={() => setDialogOpen(false)}
        onConfirm={handleSave}
      />
    </div>
  );
}
