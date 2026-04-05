'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowEditorCanvas } from '@/components/workflows/workflow-editor-canvas';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
import { VersionLabel } from '@/components/ui/version-label';
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

  const [editedTitle, setEditedTitle] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  const handleSave = useCallback(async (
    steps: WorkflowStep[],
    transitions: WorkflowDefinition['transitions'],
  ) => {
    if (!definition) return;

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
      title: editedTitle.trim() || undefined,
      description: definition.description,
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
      setSaveState({ status: 'error', message: result.error });
    }
  }, [definition, editedTitle, name, handle, router]);

  const renderSavePanel = useCallback((
    steps: WorkflowStep[],
    transitions: WorkflowDefinition['transitions'],
    onDiscard: () => void,
  ) => {
    if (!definition) return null;
    const hasChanges =
      JSON.stringify(steps) !== JSON.stringify(definition.steps) ||
      JSON.stringify(transitions) !== JSON.stringify(definition.transitions);
    if (!hasChanges) return null;

    return (
      <div className="space-y-3">
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          placeholder="Version title (required) — e.g. &quot;Added automated review step&quot;"
          className="w-full text-sm border rounded-md px-2.5 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setEditedTitle(''); setSaveState({ status: 'idle' }); onDiscard(); }}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap"
          >
            Discard changes
          </button>
          <button
            onClick={() => handleSave(steps, transitions)}
            disabled={saveState.status === 'saving' || !editedTitle.trim()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
              (saveState.status === 'saving' || !editedTitle.trim()) && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            {saveState.status === 'saving' ? 'Saving...' : 'Save new version'}
          </button>
          {saveState.status === 'saved' && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
              Saved as v{saveState.version}
            </span>
          )}
          {saveState.status === 'error' && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
              {saveState.message}
            </span>
          )}
        </div>
      </div>
    );
  }, [definition, editedTitle, saveState, handleSave]);

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
        <div className="space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground w-24 shrink-0">Workflow ID</span>
            <span className="text-sm font-mono">{decodedName}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground w-24 shrink-0">Version</span>
            <VersionLabel version={definition.version} title={definition.title} className="text-sm" />
          </div>
          {definition.description && (
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Description</span>
              <span className="text-sm text-muted-foreground">{definition.description}</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor canvas — key resets internal state when navigating to a different version */}
      <WorkflowEditorCanvas
        key={definition.version}
        initialSteps={definition.steps}
        initialTransitions={definition.transitions}
        workflowName={decodedName}
        yamlFields={{ ...definition, version: undefined, createdAt: undefined } as Record<string, unknown>}
        renderSavePanel={renderSavePanel}
      />
    </div>
  );
}
