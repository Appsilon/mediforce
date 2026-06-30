import type { NewStepPayload } from '@/lib/control-mode';

export type CMRowButton = {
  label: string;
  color: string;
  payload: NewStepPayload;
};

export type CMRow = {
  cm: 'CM0' | 'CM1' | 'CM2' | 'CM3' | 'CM4';
  color: string;
  description: string;
  disabled?: boolean;
  buttons: CMRowButton[];
};

export const STEP_TYPE_OPTIONS = [
  { value: 'creation' as const, label: 'Create new result', color: 'blue' },
  { value: 'decision' as const, label: 'Make a decision',   color: 'purple' },
] as const;

export const CM_ROWS: CMRow[] = [
  {
    cm: 'CM0',
    color: 'orange',
    description: 'No AI involved',
    buttons: [
      { label: 'Human',  color: 'orange', payload: { type: 'creation', executor: 'human' } },
      { label: 'Script', color: 'yellow', payload: { type: 'creation', executor: 'script' } },
      { label: 'Action', color: 'pink',   payload: { type: 'creation', executor: 'action' } },
    ],
  },
  {
    cm: 'CM1',
    color: 'lime',
    description: 'Human executes, AI reviews — coming soon',
    disabled: true,
    buttons: [{ label: 'Assist', color: 'lime', payload: { type: 'creation', executor: 'human' } }],
  },
  {
    cm: 'CM2',
    color: 'teal',
    description: 'Human and AI collaborate in real time',
    buttons: [{ label: 'Cowork', color: 'teal', payload: { type: 'creation', executor: 'cowork', cowork: { agent: 'chat' } } }],
  },
  {
    cm: 'CM3',
    color: 'indigo',
    description: 'AI executes, human reviews before proceeding',
    buttons: [{ label: 'Human review', color: 'indigo', payload: { type: 'creation', executor: 'agent', autonomyLevel: 'L3' } }],
  },
  {
    cm: 'CM4',
    color: 'violet',
    description: 'AI executes without waiting for human review',
    buttons: [{ label: 'Autonomous agent', color: 'violet', payload: { type: 'creation', executor: 'agent', autonomyLevel: 'L4' } }],
  },
];
