export const AUTONOMY_LEVELS = [
  { value: 'L0', label: 'L0 — Manual only' },
  { value: 'L1', label: 'L1 — Human review' },
  { value: 'L2', label: 'L2 — Auto if confident' },
  { value: 'L3', label: 'L3 — Auto + fallback' },
  { value: 'L4', label: 'L4 — Full autonomy' },
] as const;

export const STEP_TYPES = ['creation', 'review', 'decision', 'terminal'] as const;
export const STEP_TYPE_LABELS: Record<string, string> = { creation: 'Input', review: 'Review', decision: 'Decision', terminal: 'End' };

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
