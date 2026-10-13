export const STEP_TYPE_LABELS: Record<string, string> = { creation: 'Creation', review: 'Review', decision: 'Decision', terminal: 'End' };

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
