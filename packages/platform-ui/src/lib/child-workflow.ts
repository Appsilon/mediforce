import type { StepExecutionStatus, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

/** The workflow a step starts: a `spawn` with one target, or a `run-workflow`. */
export interface ChildWorkflowTarget {
  definitionName: string;
  /** Pinned by the step; without it the child runs the workflow's runnable version. */
  definitionVersion?: number;
  /** One child per item of a list only known at runtime. */
  forEach: boolean;
}

/** A spawn naming several targets starts several workflows — there is no one child to draw. */
export function childWorkflowTargetOf(step: WorkflowStep): ChildWorkflowTarget | null {
  const action = step.action;
  if (action === undefined) return null;
  if (action.kind === 'run-workflow') {
    return { definitionName: action.config.definitionName, definitionVersion: action.config.definitionVersion, forEach: false };
  }
  if (action.kind !== 'spawn') return null;
  const targets = Array.isArray(action.config.targets) ? action.config.targets : [action.config.targets];
  if (targets.length !== 1) return null;
  return {
    definitionName: targets[0].definitionName,
    definitionVersion: targets[0].definitionVersion,
    forEach: action.config.forEach !== undefined,
  };
}

/** One run of the child workflow, as the expanded group lists it. */
export interface ChildRunChoice {
  id: string;
  label: string;
  href: string;
  selected: boolean;
  onSelect: () => void;
}

/** What an expanded step draws inside its group. */
export interface ExpandedChildWorkflow {
  /** null while it loads, or when it could not be read — `message` says which. */
  definition: WorkflowDefinition | null;
  /** Workspace the child workflow lives in — the workflows its own steps start resolve there too. */
  namespace: string;
  title: string;
  href?: string;
  badge?: string;
  message?: string;
  /** Run view: the latest status of each child step in the selected child run. */
  stepStatus?: ReadonlyMap<string, StepExecutionStatus>;
  runs?: ChildRunChoice[];
}

/** What the canvas needs to make steps expandable, from whichever view owns the data. */
export interface ChildWorkflowExpansion {
  expandable: ReadonlySet<string>;
  expanded: ReadonlyMap<string, ExpandedChildWorkflow>;
  onToggle: (stepId: string) => void;
}

/** The latest execution of each step wins, so a step a loop re-ran shows where it stands now. */
export function latestStepStatus(
  executions: ReadonlyArray<{ stepId: string; status: StepExecutionStatus; startedAt: string }>,
): Map<string, StepExecutionStatus> {
  const latest = new Map<string, { status: StepExecutionStatus; startedAt: string }>();
  for (const execution of executions) {
    const current = latest.get(execution.stepId);
    if (current === undefined || execution.startedAt >= current.startedAt) {
      latest.set(execution.stepId, { status: execution.status, startedAt: execution.startedAt });
    }
  }
  return new Map([...latest].map(([stepId, entry]) => [stepId, entry.status]));
}
