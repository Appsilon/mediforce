'use client';

import { Lock } from 'lucide-react';
import { OUTPUT_TOKEN_DEFAULTS, pinDefaultModel, resolveMaxOutputTokens, type OutputBudget } from '@mediforce/platform-core';
import { useSetMyModelSettings, useUpdateNamespace } from '@/hooks/use-namespace-mutations';
import { useModelRegistry } from '@/hooks/use-model-registry';
import { DefaultModelPicker } from './default-model-picker';
import { OUTPUT_BUDGET_LABELS, OutputBudgetSlider } from './output-budget-slider';

const PLATFORM_DEFAULT_LABEL = 'Platform default (Claude Sonnet, latest)';

/** What calls on `model` (the platform default when unset) send at `budget`, as the server resolves it. */
function BudgetHint({ model, budget }: { model: string | undefined; budget: OutputBudget }) {
  const registry = useModelRegistry();
  const models = registry.data ?? [];
  const entry = models.find((candidate) => candidate.id === (model ?? pinDefaultModel(models)));
  const limit = entry?.maxCompletionTokens ?? null;
  const tokens = (defaultTokens: number) =>
    resolveMaxOutputTokens({ defaultTokens, budget, modelMaxCompletionTokens: limit }).toLocaleString('en-US');
  const raisesNothing = (budget === 'high' || budget === 'max') && limit === null;

  return (
    <p className="text-xs text-muted-foreground mt-2">
      On {entry?.name ?? model ?? 'the platform default'}: assistants {tokens(OUTPUT_TOKEN_DEFAULTS.assistant)} · cowork{' '}
      {tokens(OUTPUT_TOKEN_DEFAULTS.coworkChat)} · voice {tokens(OUTPUT_TOKEN_DEFAULTS.voiceSynthesis)} tokens.{' '}
      {raisesNothing
        ? "The registry doesn't know this model's limit, so High and Max don't raise it."
        : 'Max gives the model its full limit. Eval judges use their own model.'}
    </p>
  );
}

function useModelName(modelId: string | undefined): string {
  const registry = useModelRegistry();
  if (modelId === undefined) return 'platform default';
  return registry.data?.find((model) => model.id === modelId)?.name ?? modelId;
}

interface WorkspaceSettings {
  outputBudget: OutputBudget;
  defaultModel: string | undefined;
}

/** Owners and admins set what every call in the workspace uses unless a member picks their own. */
function WorkspaceModelSettings({ handle, workspace, onError }: {
  handle: string;
  workspace: WorkspaceSettings;
  onError: (message: string | null) => void;
}) {
  const updateNamespace = useUpdateNamespace(handle);

  function save(input: { outputBudget?: OutputBudget; defaultModel?: string | null }, failure: string) {
    onError(null);
    updateNamespace.mutate({ handle, ...input }, { onError: () => onError(failure) });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium">Workspace</p>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          Owners and admins
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        What every call in this workspace uses, unless a member picks their own.
      </p>

      <label htmlFor="workspace-default-model" className="mt-4 block text-xs font-medium">Default model</label>
      <DefaultModelPicker
        id="workspace-default-model"
        value={workspace.defaultModel}
        fallbackLabel={PLATFORM_DEFAULT_LABEL}
        onChange={(defaultModel) => save({ defaultModel }, 'Failed to save the default model.')}
      />
      <p className="text-xs text-muted-foreground mt-2">
        Assistants and cowork chat use it, and new agents, steps and judges start on it. Saved ones keep their model.
      </p>

      <div className="mt-4">
        <OutputBudgetSlider
          id="workspace-output-budget"
          title="Output budget"
          description="How much LLMs can write per call. Raise it if eval checks run out of room."
          value={workspace.outputBudget}
          onCommit={(outputBudget) => save({ outputBudget }, 'Failed to save the output budget.')}
        >
          <BudgetHint model={workspace.defaultModel} budget={workspace.outputBudget} />
        </OutputBudgetSlider>
      </div>
    </div>
  );
}

/**
 * A member's own settings, overriding the workspace's for the calls they start.
 * Picking the workspace's own value clears an override, so the member follows
 * later workspace changes.
 */
function MemberModelSettings({ handle, uid, workspace, member, onError }: {
  handle: string;
  uid: string;
  workspace: WorkspaceSettings;
  member: { outputBudget: OutputBudget | undefined; defaultModel: string | undefined };
  onError: (message: string | null) => void;
}) {
  const setMyModelSettings = useSetMyModelSettings(handle, uid);
  const workspaceModelName = useModelName(workspace.defaultModel);

  function save(input: { outputBudget?: OutputBudget | null; defaultModel?: string | null }, failure: string) {
    onError(null);
    setMyModelSettings.mutate({ handle, ...input }, { onError: () => onError(failure) });
  }

  return (
    <div>
      <p className="text-sm font-medium">You</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        Overrides the workspace for calls you start. Pick the workspace's setting to follow it.
      </p>

      <label htmlFor="member-default-model" className="mt-4 block text-xs font-medium">Default model</label>
      <DefaultModelPicker
        id="member-default-model"
        value={member.defaultModel}
        fallbackLabel={`Follow workspace (${workspaceModelName})`}
        onChange={(defaultModel) => save(
          { defaultModel: defaultModel === workspace.defaultModel ? null : defaultModel },
          'Failed to save your default model.',
        )}
      />

      <div className="mt-4">
        <OutputBudgetSlider
          id="member-output-budget"
          title="Output budget"
          description={`Workspace: ${OUTPUT_BUDGET_LABELS[workspace.outputBudget]}.`}
          value={member.outputBudget ?? workspace.outputBudget}
          onCommit={(next) => save(
            { outputBudget: next === workspace.outputBudget ? null : next },
            'Failed to save your output budget.',
          )}
        >
          <BudgetHint
            model={member.defaultModel ?? workspace.defaultModel}
            budget={member.outputBudget ?? workspace.outputBudget}
          />
        </OutputBudgetSlider>
      </div>
    </div>
  );
}

/** Default model and output budget, for the workspace and for the signed-in member. */
export function ModelSettingsSection({ handle, workspace, canEditWorkspace, member, onError }: {
  handle: string;
  workspace: WorkspaceSettings;
  canEditWorkspace: boolean;
  /** The signed-in member of a shared workspace; absent when they are its only member, whose settings the workspace's already are. */
  member?: { uid: string; outputBudget: OutputBudget | undefined; defaultModel: string | undefined };
  onError: (message: string | null) => void;
}) {
  if (canEditWorkspace === false && member === undefined) return null;

  return (
    <div className="mb-10 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Models</h2>
      <div className="rounded-lg border bg-card px-4 py-5 space-y-5">
        {canEditWorkspace && <WorkspaceModelSettings handle={handle} workspace={workspace} onError={onError} />}
        {canEditWorkspace && member !== undefined && <div className="border-t" />}
        {member !== undefined && (
          <MemberModelSettings handle={handle} uid={member.uid} workspace={workspace} member={member} onError={onError} />
        )}
      </div>
    </div>
  );
}
