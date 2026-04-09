'use client';

import { useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Save, HelpCircle } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { WorkflowEditorCanvas } from '@/components/workflows/workflow-editor-canvas';
import { saveWorkflowDefinition, type ValidationIssue } from '@/app/actions/definitions';
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
  const [versionTitle, setVersionTitle] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [stepErrors, setStepErrors] = useState<Record<string, Record<string, string>>>({});

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
    if (!description.trim()) {
      setSaveState({ status: 'error', message: 'Description is required.' });
      return;
    }
    if (!versionTitle.trim()) {
      setSaveState({ status: 'error', message: 'Version name is required.' });
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
      const parsed = parseStepErrors(result.issues ?? [], steps);
      setStepErrors(parsed);
      setSaveState({
        status: 'error',
        message: Object.keys(parsed).length > 0
          ? 'Some steps have errors — check the highlighted steps in the diagram.'
          : result.error,
      });
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
              <span className="shrink-0">v1 · Version title:</span>
              <input
                value={versionTitle}
                onChange={(e) => setVersionTitle(e.target.value)}
                placeholder="version note, e.g. Initial version"
                className={cn(
                  'bg-transparent border-b border-transparent hover:border-muted-foreground/30 focus:border-primary outline-none text-xs placeholder:text-muted-foreground/40 placeholder:italic px-0 py-px w-52',
                  !versionTitle.trim() && workflowName && 'border-amber-300 dark:border-amber-700',
                )}
              />
              <span className="group relative inline-flex items-center">
                <HelpCircle className="h-3 w-3 text-muted-foreground/40" />
                <span className="pointer-events-none absolute top-full left-0 mt-1.5 w-96 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed">
                  Each saved revision gets a version number automatically. A version note helps you tell &quot;Added AI review&quot; from &quot;Tightened criteria&quot; at a glance.
                </span>
              </span>
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
              onClick={handleSave}
              disabled={saveState.status === 'saving' || !toWorkflowId(workflowName) || !description.trim() || !versionTitle.trim()}
              title={
                !toWorkflowId(workflowName) ? 'Enter a workflow name to publish' :
                !description.trim() ? 'Add a description to publish' :
                !versionTitle.trim() ? 'Enter a version title to publish' :
                undefined
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                (saveState.status === 'saving' || !toWorkflowId(workflowName) || !description.trim() || !versionTitle.trim()) && 'opacity-50 cursor-not-allowed',
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
    </div>
  );
}
