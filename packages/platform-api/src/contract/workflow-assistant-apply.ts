import { toSlug } from '@mediforce/platform-core';
import type { WorkflowStep, WorkflowDefinition } from '@mediforce/platform-core';
import type { WorkflowAssistantToolCall } from './workflow-assistant';

type Transitions = WorkflowDefinition['transitions'];

export interface ToolCallOutcome {
  tool: WorkflowAssistantToolCall['tool'];
  stepId: string;
  error?: string;
}

export interface ApplyToolCallsResult {
  steps: WorkflowStep[];
  transitions: Transitions;
  outcomes: ToolCallOutcome[];
  addedStepIds: string[];
}

export function applyWorkflowAssistantToolCalls(
  steps: WorkflowStep[],
  transitions: Transitions,
  toolCalls: WorkflowAssistantToolCall[],
): ApplyToolCallsResult {
  let workingSteps: WorkflowStep[] = [...steps];
  let workingTransitions: Transitions = [...transitions];
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
      const nameSlug = payload.name ? toSlug(payload.name) : '';
      let newId = nameSlug || `new-step-${String(stepCounter)}`;
      if (nameSlug) {
        let suffix = 2;
        while (workingSteps.some((s) => s.id === newId)) {
          newId = `${nameSlug}-${String(suffix)}`;
          suffix += 1;
        }
      }
      const newStep = {
        ...payload,
        id: newId,
        name: payload.name || `New Step ${String(stepCounter)}`,
        ...(payload.verdicts ? { verdicts: resolveVerdicts(payload.verdicts) } : {}),
        ...(payload.executor === 'agent' ? { plugin: 'opencode-agent', autonomyLevel: payload.autonomyLevel ?? 'L2' } : {}),
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

  return { steps: workingSteps, transitions: workingTransitions, outcomes, addedStepIds };
}
