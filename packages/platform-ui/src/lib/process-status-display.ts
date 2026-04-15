/**
 * Centralized mapping of process instance (status, pauseReason) → display properties.
 *
 * Every component that shows a process status badge, label, or dot should use
 * this module instead of maintaining its own inline mapping.
 */

export type StatusColorKey = 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'created';

export interface StatusDisplay {
  /** Human-readable label shown in badges and panels */
  label: string;
  /** Semantic color key used to look up Tailwind classes */
  colorKey: StatusColorKey;
  /** Whether the instance can be resumed via a generic "Resume" button */
  resumable: boolean;
}

const PAUSE_REASON_DISPLAY: Record<string, StatusDisplay> = {
  waiting_for_human:        { label: 'Waiting for action',  colorKey: 'waiting', resumable: false },
  awaiting_agent_approval:  { label: 'Waiting for review',  colorKey: 'waiting', resumable: false },
  cowork_in_progress:       { label: 'Co-work',             colorKey: 'waiting', resumable: false },
  missing_env:              { label: 'Missing config',      colorKey: 'waiting', resumable: false },
  agent_escalated:          { label: 'Waiting for action',  colorKey: 'waiting', resumable: true },
  agent_paused:             { label: 'Waiting for action',  colorKey: 'waiting', resumable: true },
  step_failure:             { label: 'Error',              colorKey: 'blocked', resumable: true },
  routing_error:            { label: 'Error',              colorKey: 'blocked', resumable: true },
  max_iterations_exceeded:  { label: 'Error',              colorKey: 'blocked', resumable: true },
};

const BASE_STATUS_DISPLAY: Record<string, StatusDisplay> = {
  running:   { label: 'Running',   colorKey: 'running',   resumable: false },
  completed: { label: 'Completed', colorKey: 'completed', resumable: false },
  failed:    { label: 'Failed',    colorKey: 'failed',    resumable: false },
  created:   { label: 'Created',   colorKey: 'created',   resumable: false },
  paused:    { label: 'Paused',    colorKey: 'waiting',   resumable: true },
};

/**
 * Resolve the display properties for a process instance.
 *
 * When `status` is `'paused'`, the `pauseReason` determines the label and color.
 * For all other statuses, the base mapping is used directly.
 */
export function getProcessStatusDisplay(
  status: string,
  pauseReason?: string | null,
): StatusDisplay {
  if (status === 'paused' && pauseReason) {
    return PAUSE_REASON_DISPLAY[pauseReason] ?? { label: 'Paused', colorKey: 'waiting', resumable: true };
  }
  return BASE_STATUS_DISPLAY[status] ?? { label: status, colorKey: 'created', resumable: false };
}
