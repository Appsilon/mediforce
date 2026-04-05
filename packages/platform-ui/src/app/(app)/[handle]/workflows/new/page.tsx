'use client';

import { useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { WorkflowEditorCanvas } from '@/components/workflows/workflow-editor-canvas';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
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
  const [versionTitle] = useState('Initial version');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  // Track current canvas state so the header button can trigger save
  const currentStepsRef = useRef<WorkflowStep[]>(TEMPLATE_STEPS);
  const currentTransitionsRef = useRef<WorkflowDefinition['transitions']>(TEMPLATE_TRANSITIONS);

  const handleCanvasChange = useCallback(
    (steps: WorkflowStep[], transitions: WorkflowDefinition['transitions']) => {
      currentStepsRef.current = steps;
      currentTransitionsRef.current = transitions;
    },
    [],
  );

  // Auto-select first namespace when namespaces load
  const effectiveNamespace = namespace || namespaces[0]?.handle || '';

  const handleSave = useCallback(async () => {
    const steps = currentStepsRef.current;
    const transitions = currentTransitionsRef.current;
    const workflowId = toWorkflowId(workflowName);
    if (!workflowId) {
      setSaveState({ status: 'error', message: 'Workflow name is required.' });
      return;
    }

    const missingPlugin = steps.filter(
      (s) => s.type !== 'terminal' && (s.executor === 'agent' || s.executor === 'script') && !s.plugin,
    );
    if (missingPlugin.length > 0) {
      setSaveState({ status: 'error', message: `Plugin required for agent/script steps: ${missingPlugin.map((s) => `"${s.name}"`).join(', ')}` });
      return;
    }

    const idCounts = new Map<string, number>();
    for (const s of steps) idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
    const dupes = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    if (dupes.length > 0) {
      setSaveState({ status: 'error', message: `Duplicate step IDs: ${dupes.join(', ')}` });
      return;
    }

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
      name: workflowId,
      namespace: effectiveNamespace || undefined,
      title: versionTitle.trim() || undefined,
      description: description.trim() || undefined,
      steps,
      transitions: mergedTransitions,
      triggers: [{ type: 'manual', name: 'start' }],
    });

    if (result.success) {
      setSaveState({ status: 'saved', name: result.name });
      setTimeout(() => {
        router.push(`/${handle}/workflows/${encodeURIComponent(result.name)}/definitions/${result.version}`);
      }, 500);
    } else {
      setSaveState({ status: 'error', message: result.error });
    }
  }, [workflowName, effectiveNamespace, versionTitle, description, handle, router]);


  const yamlFields: Record<string, unknown> = {
    name: toWorkflowId(workflowName) || 'my-workflow',
    namespace: effectiveNamespace || undefined,
    description: description || undefined,
    triggers: [{ type: 'manual', name: 'start' }],
  };

  return (
    <div className="flex flex-1 flex-col relative">
      {/* Header */}
      <div className="border-b px-6 py-4 sticky top-0 z-30 bg-background space-y-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Design your workflow visually. The canvas below shows a two-step starter: a human task followed by an AI agent review. Click any step to edit it, use the toolbar to add or rearrange steps, then click <strong>Save and publish workflow</strong> above.
        </p>

        <div className="flex flex-wrap items-end gap-4">
          {/* Owner */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Owner</label>
            <select
              value={effectiveNamespace}
              onChange={(e) => setNamespace(e.target.value)}
              disabled={namespacesLoading || namespaces.length === 0}
              className={cn(
                'rounded-md border bg-background px-3 py-1.5 text-sm outline-none',
                'focus:ring-1 focus:ring-ring focus:border-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {namespacesLoading ? (
                <option value="">Loading...</option>
              ) : (
                namespaces.map((ns) => (
                  <option key={ns.handle} value={ns.handle}>
                    {ns.displayName ?? ns.handle} (@{ns.handle})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Workflow name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Workflow ID <span className="text-muted-foreground/50 font-normal">(used in URLs, auto-slugged)</span>
            </label>
            <input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="e.g. clinical-trial-review"
              className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring min-w-64"
            />
            {workflowName && (
              <span className="text-[11px] text-muted-foreground font-mono">
                ID: {toWorkflowId(workflowName) || '—'}
              </span>
            )}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="text-xs font-medium text-muted-foreground">Description <span className="text-muted-foreground/50 font-normal">(optional)</span></label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
              className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring"
            />
          </div>

          {/* Save button */}
          <div className="flex flex-col gap-1">
            <div className="h-[18px]" />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saveState.status === 'saving' || !toWorkflowId(workflowName)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                  (saveState.status === 'saving' || !toWorkflowId(workflowName)) && 'opacity-50 cursor-not-allowed',
                )}
              >
                <Save className="h-3.5 w-3.5" />
                {saveState.status === 'saving' ? 'Publishing...' : 'Save and publish workflow'}
              </button>
              {saveState.status === 'saved' && (
                <span className="inline-flex items-center rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                  Created — redirecting…
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

      {/* Editor canvas */}
      <WorkflowEditorCanvas
        initialSteps={TEMPLATE_STEPS}
        initialTransitions={TEMPLATE_TRANSITIONS}
        yamlFields={yamlFields}
        onChange={handleCanvasChange}
      />
    </div>
  );
}
