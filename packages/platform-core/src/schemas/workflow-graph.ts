import type { WorkflowDefinition, WorkflowStep } from './workflow-definition';
import type { ProcessDefinition } from './process-definition';

type Transitions = WorkflowDefinition['transitions'];

export function toProcessDefinition(definition: WorkflowDefinition): ProcessDefinition {
  return {
    name: definition.name,
    version: String(definition.version),
    steps: definition.steps.map((step) => ({
      id: step.id,
      name: step.name,
      type: step.type,
      ...(step.verdicts ? { verdicts: step.verdicts } : {}),
      ...(step.selection !== undefined ? { selection: step.selection } : {}),
      ...(step.ui ? { ui: step.ui } : {}),
      ...(step.params ? { params: step.params } : {}),
      ...(step.description ? { description: step.description } : {}),
      ...(step.metadata ? { metadata: step.metadata } : {}),
    })),
    transitions: definition.transitions,
    triggers: definition.triggers,
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.metadata ? { metadata: definition.metadata } : {}),
  };
}

export function mergeVerdictTransitions(steps: WorkflowStep[], transitions: Transitions): Transitions {
  const merged = [...transitions];
  for (const step of steps) {
    if ((step.type === 'review' || step.type === 'decision') && step.verdicts) {
      for (const verdict of Object.values(step.verdicts)) {
        if (verdict.target && !merged.some((t) => t.from === step.id && t.to === verdict.target)) {
          merged.push({ from: step.id, to: verdict.target });
        }
      }
    }
  }
  return merged;
}

// Both the engine's startInstance and validateStepGraph's reachability check treat
// steps[0] (array position) as the entry point. Reorders so the step with no
// incoming transition is first; no-ops when there isn't exactly one such candidate.
export function ensureEntryStepFirst(steps: WorkflowStep[], transitions: Transitions): WorkflowStep[] {
  const targets = new Set(transitions.map((t) => t.to));
  const candidates = steps.filter((s) => !targets.has(s.id));
  if (candidates.length !== 1 || steps[0]?.id === candidates[0].id) return steps;
  const entry = candidates[0];
  return [entry, ...steps.filter((s) => s.id !== entry.id)];
}

export interface ReferenceIssue {
  severity: 'error' | 'warning';
  message: string;
}

const HUMAN_COMPLETION_KEYS = new Set([
  'verdict', 'comment', 'selection', 'rows', 'assignments', 'uploads', 'files', 'options',
]);

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
}

function computeAncestors(steps: WorkflowStep[], transitions: Transitions): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (!reverse.has(to)) reverse.set(to, new Set());
    reverse.get(to)!.add(from);
  };
  for (const t of transitions) addEdge(t.from, t.to);
  for (const s of steps) {
    if (s.verdicts) for (const v of Object.values(s.verdicts)) if (v.target) addEdge(s.id, v.target);
  }
  const ancestors = new Map<string, Set<string>>();
  for (const s of steps) {
    const seen = new Set<string>();
    const queue = [...(reverse.get(s.id) ?? [])];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of reverse.get(cur) ?? []) if (!seen.has(p)) queue.push(p);
    }
    ancestors.set(s.id, seen);
  }
  return ancestors;
}

export function validateStepReferences(steps: WorkflowStep[], transitions: Transitions): ReferenceIssue[] {
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const ancestors = computeAncestors(steps, transitions);
  const issues: ReferenceIssue[] = [];
  const seenMessages = new Set<string>();
  const push = (severity: ReferenceIssue['severity'], message: string) => {
    if (seenMessages.has(message)) return;
    seenMessages.add(message);
    issues.push({ severity, message });
  };

  for (const step of steps) {
    const scanned: string[] = [];
    if (step.action) collectStrings(step.action, scanned);
    if (typeof step.assignedTo === 'string') scanned.push(step.assignedTo);

    for (const str of scanned) {
      for (const match of str.matchAll(PLACEHOLDER_RE)) {
        const raw = match[1].trim();
        if (raw !== 'steps' && !raw.startsWith('steps.') && !raw.startsWith('steps[')) continue;
        const rest = raw.slice('steps'.length).replace(/^[.[]/, '');
        if (!rest) continue;
        const refId = /^([^.[\]]+)/.exec(rest)?.[1];
        if (!refId) continue;
        const subPath = rest.slice(refId.length).replace(/^[.[]/, '');

        const target = stepById.get(refId);
        if (!target) {
          push('error', `Step "${step.id}" references \${steps.${refId}…} but no step "${refId}" exists.`);
          continue;
        }
        if (refId === step.id || !ancestors.get(step.id)?.has(refId)) {
          push('warning', `Step "${step.id}" references \${steps.${refId}…}, but "${refId}" is not upstream of it — its output will not be available when this step runs.`);
        }
        if (!subPath) {
          push('warning', `Step "${step.id}" references the whole \${steps.${refId}} object, which renders as raw JSON — reference a specific field like \${steps.${refId}.<field>}.`);
          continue;
        }
        if (target.type !== 'terminal' && target.executor === 'human') {
          const firstKey = /^([^.[\]]+)/.exec(subPath)?.[1] ?? subPath;
          const paramNames = new Set((target.params ?? []).map((p) => p.name));
          if (!paramNames.has(firstKey) && !HUMAN_COMPLETION_KEYS.has(firstKey)) {
            const severity = paramNames.size > 0 ? 'error' : 'warning';
            const detail = paramNames.size > 0
              ? ` (its params: ${[...paramNames].join(', ')})`
              : ' (it declares no input params)';
            push(severity, `Step "${step.id}" references \${steps.${refId}.${firstKey}}, but human step "${refId}" produces no "${firstKey}"${detail}.`);
          }
        }
      }
    }
  }
  return issues;
}
