import { uniqueSlug } from '../utils/slug';
import type { WorkflowStep, WorkflowDefinition } from './workflow-definition';
import type { WorkflowAuthorableSchema } from './workflow-definition';
import type { z } from 'zod';
import type { WorkflowAssistantToolCall } from './workflow-assistant-tools';

type Transitions = WorkflowDefinition['transitions'];
type InputForNextRunEntry = NonNullable<WorkflowDefinition['inputForNextRun']>[number];

export interface ToolCallOutcome {
  tool: WorkflowAssistantToolCall['tool'];
  /** The step a call touched. For the workflow-level tools there is no step, so
   *  it names what changed instead — the field list, or the edge. */
  stepId: string;
  error?: string;
}

/** The workflow-level fields the assistant can now write, held alongside the
 *  graph because a step tool and a settings tool arrive in the same batch. */
export type WorkflowSettings = Partial<
  Omit<
    z.infer<typeof WorkflowAuthorableSchema>,
    'name' | 'steps' | 'transitions' | 'inputForNextRun' | 'externalSkillsRepo'
  >
> & {
  /** Partial because an editor holds it while it is being typed: the definition
   *  requires `commit`, but demanding it on the first keystroke would make the
   *  field unfillable. Registration is what validates the finished value. */
  externalSkillsRepo?: Partial<
    NonNullable<z.infer<typeof WorkflowAuthorableSchema>['externalSkillsRepo']>
  >;
};

export interface ApplyToolCallsResult {
  steps: WorkflowStep[];
  transitions: Transitions;
  settings: WorkflowSettings;
  /** Outputs carried into the next run. Graph-adjacent rather than settings:
   *  every entry names a step, so it is resolved and validated with them. */
  inputForNextRun: InputForNextRunEntry[] | undefined;
  outcomes: ToolCallOutcome[];
  addedStepIds: string[];
}

export function applyWorkflowAssistantToolCalls(
  steps: WorkflowStep[],
  transitions: Transitions,
  toolCalls: WorkflowAssistantToolCall[],
  settings: WorkflowSettings = {},
  inputForNextRun?: InputForNextRunEntry[],
): ApplyToolCallsResult {
  let workingSteps: WorkflowStep[] = [...steps];
  let workingTransitions: Transitions = [...transitions];
  let workingSettings: WorkflowSettings = { ...settings };
  let workingInputForNextRun = inputForNextRun;
  const clientIdToRealId = new Map<string, string>();
  const outcomes: ToolCallOutcome[] = [];
  const addedStepIds: string[] = [];

  let stepCounter = steps.reduce((max, s) => {
    const match = /^new-step-(\d+)$/.exec(s.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  const resolveId = (id: string | null | undefined): string | null =>
    id ? (clientIdToRealId.get(id) ?? id) : null;

  const resolveVerdicts = (verdicts: WorkflowStep['verdicts']): WorkflowStep['verdicts'] => {
    if (!verdicts) return verdicts;
    const out: NonNullable<WorkflowStep['verdicts']> = {};
    for (const [key, verdict] of Object.entries(verdicts)) {
      out[key] = { ...verdict, target: resolveId(verdict.target) ?? verdict.target };
    }
    return out;
  };

  for (const call of toolCalls) {
    if (call.tool === 'add_step') {
      const { insertAfterId, insertBeforeId, clientId, ...payload } = call.arguments;
      stepCounter += 1;
      const existingIds = workingSteps.map((step) => step.id);
      const newId = uniqueSlug(payload.name ?? '', existingIds)
        || uniqueSlug(`new-step-${String(stepCounter)}`, existingIds);
      const newStep = {
        ...payload,
        id: newId,
        name: payload.name || `New Step ${String(stepCounter)}`,
        ...(payload.verdicts ? { verdicts: resolveVerdicts(payload.verdicts) } : {}),
        ...(payload.executor === 'agent' ? { plugin: 'opencode-agent', autonomyLevel: payload.autonomyLevel ?? 'L3' } : {}),
        ...(payload.executor === 'script' ? { plugin: 'script-container' } : {}),
        ...(payload.executor === 'cowork' ? { cowork: payload.cowork ?? { agent: 'chat' as const } } : {}),
      } as WorkflowStep;

      const afterId = resolveId(insertAfterId);
      const beforeId = resolveId(insertBeforeId);
      const terminal = workingSteps.find((s) => s.type === 'terminal');

      if (!terminal) {
        const lastId = workingSteps[workingSteps.length - 1]?.id;
        workingSteps = [...workingSteps, newStep];
        if (lastId) workingTransitions = [...workingTransitions, { from: lastId, to: newId }];
      } else if (afterId && afterId !== terminal.id && workingSteps.some((s) => s.id === afterId)) {
        const idx = workingSteps.findIndex((s) => s.id === afterId);
        const next = [...workingSteps];
        next.splice(idx + 1, 0, newStep);
        workingSteps = next;
        if (beforeId) {
          workingTransitions = [
            ...workingTransitions.filter((t) => !(t.from === afterId && t.to === beforeId)),
            { from: afterId, to: newId },
            { from: newId, to: beforeId },
          ];
        } else {
          const outgoing = workingTransitions.filter((t) => t.from === afterId);
          workingTransitions = [
            ...workingTransitions.filter((t) => t.from !== afterId),
            { from: afterId, to: newId },
            ...outgoing.map((t) => ({ from: newId, to: t.to })),
          ];
        }
      } else {
        const tIdx = workingSteps.findIndex((s) => s.id === terminal.id);
        const next = [...workingSteps];
        next.splice(tIdx, 0, newStep);
        workingSteps = next;
        workingTransitions = [
          ...workingTransitions.map((t) => (t.to === terminal.id ? { ...t, to: newId } : t)),
          { from: newId, to: terminal.id },
        ];
      }
      if (clientId) clientIdToRealId.set(clientId, newId);
      addedStepIds.push(newId);
      outcomes.push({ tool: 'add_step', stepId: newId });
    } else if (call.tool === 'update_workflow') {
      // Patch, not replace: a call naming one field must leave the others
      // alone, or "also set the preamble" would clear the env set a turn ago.
      //
      // `visibility` carries a `.default('private')` that `.partial()` does not
      // strip, so a parsed patch always claims a visibility the model never
      // wrote — narrowing a public workflow on an unrelated edit. Only keys the
      // call actually supplied are applied.
      const supplied = Object.entries(call.arguments).filter(([, value]) => value !== undefined);
      const patch = Object.fromEntries(supplied) as WorkflowSettings & {
        inputForNextRun?: InputForNextRunEntry[];
      };
      // Carry-over names steps, so it travels with the graph rather than the
      // settings — and its ids go through the same resolution, or an entry
      // naming a step added in this very batch would point at nothing.
      if (patch.inputForNextRun !== undefined) {
        workingInputForNextRun = patch.inputForNextRun.map((entry) => ({
          ...entry,
          stepId: resolveId(entry.stepId) ?? entry.stepId,
        }));
        delete patch.inputForNextRun;
      }
      // `env` and `metadata` are maps: a shallow spread would make "add
      // STUDY_ID" drop every other variable, and "set a category" wipe the
      // display name. Merged key by key, so a patch adds rather than replaces.
      workingSettings = {
        ...workingSettings,
        ...patch,
        ...(patch.env === undefined ? {} : { env: { ...workingSettings.env, ...patch.env } }),
        ...(patch.metadata === undefined ? {} : { metadata: { ...workingSettings.metadata, ...patch.metadata } }),
        ...(patch.externalSkillsRepo === undefined
          ? {}
          : { externalSkillsRepo: { ...workingSettings.externalSkillsRepo, ...patch.externalSkillsRepo } }),
      };
      outcomes.push({ tool: 'update_workflow', stepId: supplied.map(([key]) => key).join(', ') });
    } else if (call.tool === 'write_workflow_file') {
      const { path, contents } = call.arguments;
      const existing = workingSettings.artifacts ?? [];
      const at = existing.findIndex((artifact) => artifact.path === path);
      // Replaced in place rather than appended, so the order a person sees in
      // the files panel does not shuffle every time a file is rewritten.
      workingSettings = {
        ...workingSettings,
        artifacts: at === -1
          ? [...existing, { path, contents }]
          : existing.map((artifact, i) => (i === at ? { path, contents } : artifact)),
      };
      outcomes.push({ tool: 'write_workflow_file', stepId: path });
    } else if (call.tool === 'remove_workflow_file') {
      const { path } = call.arguments;
      const existing = workingSettings.artifacts ?? [];
      if (existing.some((artifact) => artifact.path === path) === false) {
        outcomes.push({
          tool: 'remove_workflow_file',
          stepId: path,
          error: `This workflow carries no file at "${path}", so there was nothing to remove.`,
        });
        continue;
      }
      const kept = existing.filter((artifact) => artifact.path !== path);
      // An empty list is not the same as carrying no files: it would register
      // as `artifacts: []` and read as a deliberate empty set.
      workingSettings = {
        ...workingSettings,
        artifacts: kept.length > 0 ? kept : undefined,
      };
      outcomes.push({ tool: 'remove_workflow_file', stepId: path });
    } else if (call.tool === 'set_transition_condition') {
      const { from: rawFrom, to: rawTo, when } = call.arguments;
      // Same resolution as every other tool: "add a check step, and only
      // escalate when severity is high" is one request, and the step it names
      // has no real id until this batch is applied.
      const from = resolveId(rawFrom) ?? rawFrom;
      const to = resolveId(rawTo) ?? rawTo;
      const edge = workingTransitions.find((t) => t.from === from && t.to === to);
      if (edge === undefined) {
        outcomes.push({
          tool: 'set_transition_condition',
          stepId: `${from} → ${to}`,
          error: `There is no transition from "${from}" to "${to}" — add the edge before giving it a condition.`,
        });
        continue;
      }
      workingTransitions = workingTransitions.map((t) => {
        if (t.from !== from || t.to !== to) return t;
        // An omitted `when` clears it, which is how an edge goes back to
        // unconditional; keeping the key with `undefined` would serialise.
        const { when: _dropped, ...rest } = t;
        return when === undefined ? rest : { ...rest, when };
      });
      outcomes.push({ tool: 'set_transition_condition', stepId: `${from} → ${to}` });
    } else if (call.tool === 'update_step') {
      const { stepId, insertAfterId, insertBeforeId, ...patch } = call.arguments;
      const realId = resolveId(stepId) ?? stepId;
      const current = workingSteps.find((s) => s.id === realId);
      if (!current) {
        outcomes.push({
          tool: 'update_step',
          stepId: realId,
          error: `Step "${stepId}" doesn't exist (it may have been removed earlier in this batch, or the id is wrong).`,
        });
        continue;
      }
      const merged: WorkflowStep = { ...current, ...patch };
      if (patch.agent) merged.agent = { ...current.agent, ...patch.agent };
      if (patch.verdicts) merged.verdicts = resolveVerdicts(patch.verdicts);
      workingSteps = workingSteps.map((s) => (s.id === realId ? merged : s));

      const afterId = resolveId(insertAfterId);
      const beforeId = resolveId(insertBeforeId);
      if (afterId) {
        if (beforeId) {
          workingTransitions = [
            ...workingTransitions.filter((t) => !(t.from === afterId && t.to === beforeId)),
            { from: afterId, to: realId },
            { from: realId, to: beforeId },
          ];
        } else if (!workingTransitions.some((t) => t.from === afterId && t.to === realId)) {
          workingTransitions = [...workingTransitions, { from: afterId, to: realId }];
        }
      }
      outcomes.push({ tool: 'update_step', stepId: realId });
    } else {
      const realId = resolveId(call.arguments.stepId) ?? call.arguments.stepId;
      if (!workingSteps.some((s) => s.id === realId)) {
        outcomes.push({
          tool: 'remove_step',
          stepId: realId,
          error: `Step "${call.arguments.stepId}" doesn't exist (it may have already been removed earlier in this batch, or the id is wrong).`,
        });
        continue;
      }
      workingSteps = workingSteps.filter((s) => s.id !== realId);
      const incoming = workingTransitions.filter((t) => t.to === realId);
      const outgoing = workingTransitions.filter((t) => t.from === realId);
      const unrelated = workingTransitions.filter((t) => t.from !== realId && t.to !== realId);
      workingTransitions = [
        ...unrelated,
        ...incoming.flatMap((inc) => outgoing.map((out) => ({ from: inc.from, to: out.to }))),
      ];
      outcomes.push({ tool: 'remove_step', stepId: realId });
    }
  }

  return {
    steps: workingSteps,
    transitions: workingTransitions,
    settings: workingSettings,
    inputForNextRun: workingInputForNextRun,
    outcomes,
    addedStepIds,
  };
}
