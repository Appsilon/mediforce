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

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}
