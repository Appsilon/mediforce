import type { NewStepPayload } from '@/lib/control-mode';

export type CMRowButton = {
  /** Stable identifier — React key and test hook. */
  id: string;
  label: string;
  /** What work belongs on this executor, so the picker answers "which one do I
   *  pick?" without a trip to docs/reference/workflow-authoring-golden-rules.md (#1186). */
  purpose: string;
  color: string;
  // The step type (creation/decision) is chosen by the picker toggle and merged
  // in at add time, so presets only carry the executor-shaped fields.
  payload: Omit<NewStepPayload, 'type'>;
};

export type CMRow = {
  cm: 'CM0' | 'CM1' | 'CM2' | 'CM3' | 'CM4';
  color: string;
  buttons: CMRowButton[];
};

export const STEP_TYPE_OPTIONS = [
  {
    value: 'creation' as const,
    label: 'Create new result',
    purpose: 'A normal work step: it produces a result later steps read. Most steps are this.',
    color: 'blue',
  },
  {
    value: 'decision' as const,
    label: 'Make a decision',
    purpose: 'A routing step: it picks which branch the run takes next, and records its verdict for later steps to read.',
    color: 'purple',
  },
] as const;

export const CM_ROWS: CMRow[] = [
  {
    cm: 'CM0',
    color: 'orange',
    buttons: [
      {
        id: 'human',
        label: 'Human',
        purpose: 'Input, accountability, approval, rejection, classification. Work a person has to sign for.',
        color: 'orange',
        payload: { executor: 'human' },
      },
      {
        id: 'script',
        label: 'Script',
        purpose: 'Deterministic parsing, validation, conversion, file work, API glue. Same input, same output, every run.',
        color: 'yellow',
        payload: { executor: 'script' },
      },
      {
        id: 'action',
        label: 'Action',
        purpose: 'Built-in side effects with no code to maintain: reshape, HTTP call, email, spawn a workflow, wait.',
        color: 'pink',
        payload: { executor: 'action' },
      },
    ],
  },
  {
    cm: 'CM1',
    color: 'lime',
    buttons: [
      {
        id: 'assist',
        label: 'Assist',
        purpose: 'A person does the work and an agent reviews it. Coming soon.',
        color: 'lime',
        payload: { executor: 'human' },
      },
    ],
  },
  {
    cm: 'CM2',
    color: 'teal',
    buttons: [
      {
        id: 'cowork',
        label: 'Cowork',
        purpose: 'Human and agent build the result together in real time, over chat or voice.',
        color: 'teal',
        payload: { executor: 'cowork', cowork: { agent: 'chat' } },
      },
    ],
  },
  {
    cm: 'CM3',
    color: 'indigo',
    buttons: [
      {
        id: 'human-review',
        label: 'Human review',
        purpose: 'Judgment, synthesis, planning, flexible edits. The agent drafts, then a person approves or sends it back before the run continues.',
        color: 'indigo',
        payload: { executor: 'agent', autonomyLevel: 'L3' },
      },
    ],
  },
  {
    cm: 'CM4',
    color: 'violet',
    buttons: [
      {
        id: 'autonomous-agent',
        label: 'Autonomous agent',
        purpose: 'The same agent work with no approval gate. Pick it once the constraints have been approved upstream.',
        color: 'violet',
        payload: { executor: 'agent', autonomyLevel: 'L4' },
      },
    ],
  },
];
