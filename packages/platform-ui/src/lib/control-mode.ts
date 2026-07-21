/**
 * Control mode — the UI-only abstraction over executor + autonomyLevel.
 *
 * The schema fields `executor` and `autonomyLevel` are never renamed.
 * `ControlMode` exists only in the UI layer and is never written to storage.
 *
 * Mapping (ADR-0006: docs/adr/0006-control-mode-ui-concept.md):
 *   CM0  No agent          executor: human | script | action
 *                          also: executor: agent, autonomyLevel: L0 | L1  (developer-only flags)
 *   CM1  Assist            not yet implemented — disabled in wizard UI
 *   CM2  Cowork            executor: cowork
 *   CM3  Human review      executor: agent, autonomyLevel: L3
 *   CM4  Autonomous agent  executor: agent, autonomyLevel: L4
 *                          also: executor: agent, autonomyLevel: undefined | unknown
 *                          (legacy steps without an explicit level default to autonomous)
 *
 * Note: executor: agent, autonomyLevel: L2 (old Ghost/Assist) maps to 'assist' for
 * display of existing steps, but is no longer creatable from the wizard.
 */
import type { WorkflowStep } from '@mediforce/platform-core';

/** Step executor — the canonical union from the WorkflowStep schema. */
export type Executor = WorkflowStep['executor'];

export type ControlMode =
  | 'no-agent'
  | 'assist'
  | 'cowork'
  | 'human-review'
  | 'autonomous-agent';

/** Control Mode identifier shown to users (CM0–CM4). */
export const CONTROL_MODE_NUMBER: Record<ControlMode, string> = {
  'no-agent':         'CM0',
  'assist':            'CM1',
  'cowork':           'CM2',
  'human-review':     'CM3',
  'autonomous-agent': 'CM4',
};

export const CONTROL_MODE_LABELS: Record<ControlMode, string> = {
  'no-agent':         'No agent',
  'assist':            'Assist',
  'cowork':           'Cowork',
  'human-review':     'Human review',
  'autonomous-agent': 'Autonomous agent',
};

export const CONTROL_MODE_DESCRIPTIONS: Record<ControlMode, string> = {
  'no-agent':         'Step handled by a human, script, or action — no AI agent involved.',
  'assist':            'Human leads and executes; AI reviews the result. (Coming soon)',
  'cowork':           'Agent and human collaborate in real-time via chat or voice.',
  'human-review':     'Agent executes, human reviews and approves before the workflow proceeds.',
  'autonomous-agent': 'Agent executes and the result advances the workflow without human review.',
};

/** Modes disabled in the wizard (shown but not selectable). */
export const CONTROL_MODE_DISABLED: Record<ControlMode, boolean> = {
  'no-agent':         false,
  'assist':            true,
  'cowork':           false,
  'human-review':     false,
  'autonomous-agent': false,
};

/**
 * Derive the UI control mode from stored schema values.
 * L0 and L1 silently map to 'no-agent' — developer-only flags set via raw JSON.
 * undefined/null (no level set) and any unrecognised value (e.g. a future L5 the UI
 * hasn't caught up to) map to 'autonomous-agent' — the step does run an agent, so
 * "No agent" would be semantically wrong. Silent-fallback-to-autonomous is less harmful
 * than silent-fallback-to-no-agent when the engine is ahead of the UI.
 * L2 maps to 'assist' for display of existing steps.
 */
export function getControlMode(
  executor: string | undefined,
  autonomyLevel?: string | null,
): ControlMode {
  if (executor === 'cowork') return 'cowork';
  if (executor !== 'agent') return 'no-agent';
  switch (autonomyLevel) {
    case 'L2': return 'assist';
    case 'L3': return 'human-review';
    case 'L4': return 'autonomous-agent';
    case 'L0':
    case 'L1': return 'no-agent'; // developer-only instrumentation flags
    default:   return 'autonomous-agent'; // undefined, null, or unknown future level
  }
}

/**
 * Map a control mode back to the executor/autonomyLevel values to write.
 * For 'no-agent', `subExecutor` selects between human/script/action.
 * 'assist' (CM1) is disabled in the wizard; this is kept for completeness.
 *
 * Roundtrip note: a legacy step stored as `{executor:'agent'}` (no autonomyLevel)
 * displays as 'autonomous-agent' via getControlMode. If the user opens and saves
 * that step in the wizard, controlModeToSchema writes back `autonomyLevel:'L4'`.
 * This is intentional — it normalises legacy data on the next edit.
 */
export function controlModeToSchema(
  mode: ControlMode,
  subExecutor: 'human' | 'script' | 'action' = 'human',
): { executor: string; autonomyLevel?: string } {
  switch (mode) {
    case 'no-agent':         return { executor: subExecutor };
    case 'assist':            return { executor: 'agent', autonomyLevel: 'L2' };
    case 'cowork':           return { executor: 'cowork' };
    case 'human-review':     return { executor: 'agent', autonomyLevel: 'L3' };
    case 'autonomous-agent': return { executor: 'agent', autonomyLevel: 'L4' };
  }
}

/** Payload for creating a new step from the wizard popover. */
export type NewStepPayload = {
  type: 'creation' | 'decision';
  executor: Executor;
  autonomyLevel?: string;
  agentId?: string;
  cowork?: { agent: 'chat' | 'voice-realtime' };
};
