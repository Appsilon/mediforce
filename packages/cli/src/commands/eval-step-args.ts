import { readFileSync } from 'node:fs';

/** The agent Workflow Step every `mediforce eval` command is about. */
export const STEP_ARGS = {
  namespace: { type: 'string', required: true, description: 'Workspace handle' },
  workflow: { type: 'string', required: true, description: 'Workflow name' },
  step: { type: 'string', required: true, description: 'Agent step id' },
} as const;

export function stepFrom(args: { namespace: string; workflow: string; step: string }) {
  return { namespace: args.namespace, workflowName: args.workflow, stepId: args.step };
}

/**
 * What a command that works on either is about: an agent Workflow Step by
 * `--workflow` and `--step`, or an Agent evaluated on its own by `--agent`
 * (ADR-0029).
 */
export const SUBJECT_ARGS = {
  namespace: { type: 'string', required: true, description: 'Workspace handle' },
  workflow: { type: 'string', description: 'Workflow name (with --step)' },
  step: { type: 'string', description: 'Agent step id (with --workflow)' },
  agent: { type: 'string', description: 'Agent id — evaluate the agent on its own, instead of --workflow and --step' },
} as const;

export function subjectFrom(args: { namespace: string; workflow?: string; step?: string; agent?: string }) {
  const step = args.workflow !== undefined && args.step !== undefined;
  if (args.agent !== undefined && args.workflow === undefined && args.step === undefined) {
    return { namespace: args.namespace, agentId: args.agent };
  }
  if (step && args.agent === undefined) return { namespace: args.namespace, workflowName: args.workflow, stepId: args.step };
  throw new Error('Name a step with --workflow and --step, or an agent with --agent');
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}
