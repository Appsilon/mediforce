/** L2/L3/L4 only — the three modes surfaced in the wizard. L0/L1 are developer-only (raw YAML). */
export const AGENT_CONTROL_MODES = [
  { value: 'L2' as const, label: 'Assist — agent draft, human approves' },
  { value: 'L3' as const, label: 'Human review — agent output, explicit approval' },
  { value: 'L4' as const, label: 'Autonomous agent — executes without review' },
] as const;

export const STEP_TYPE_LABELS: Record<string, string> = { creation: 'Creation', review: 'Review', decision: 'Decision', terminal: 'End' };

export const FALLBACK_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'escalate_to_human', label: 'Escalate to human' },
  { value: 'continue_with_flag', label: 'Continue with flag' },
  { value: 'pause', label: 'Pause' },
] as const;

export const KNOWN_MODELS = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
] as const;

export const RUNTIME_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'bash', label: 'Bash' },
] as const;
