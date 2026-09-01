import { CONTROL_MODE_LABELS, type ControlMode, type NewStepPayload } from '@/lib/control-mode';

export type ExecutorOption = {
  /** Stable identifier — React key and test hook. */
  id: string;
  label: string;
  /** What work belongs on this executor, so the picker answers "which one do I
   *  pick?" without a trip to docs/reference/workflow-authoring-golden-rules.md (#1186). */
  purpose: string;
  /**
   * The control mode this option creates. Carried explicitly rather than derived
   * from `payload`: Assist has no storage shape yet, so its payload is a plain
   * human step and `getControlMode` would read it as No agent.
   */
  mode: ControlMode;
  // The step type (creation/decision) is chosen by the picker toggle and merged
  // in at add time, so presets only carry the executor-shaped fields.
  payload: Omit<NewStepPayload, 'type'>;
};

export type ExecutorSection = {
  /** Stable key — React key, fold state, and test hook (`section-<id>`). */
  id: 'no-agent' | 'agent';
  label: string;
  color: string;
  options: ExecutorOption[];
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

/**
 * Full tier, split by the one question an author answers first: does this step
 * run an agent? The four agent modes (CM1–CM4, ADR-0014) differ only in how much
 * human control they keep, which is a choice worth making inside one card rather
 * than across four. `Agent` therefore labels a group, not a single control mode,
 * so it has no entry in `CONTROL_MODE_LABELS`.
 */
export const EXECUTOR_SECTIONS: ExecutorSection[] = [
  {
    id: 'no-agent',
    label: CONTROL_MODE_LABELS['no-agent'],
    color: 'orange',
    options: [
      {
        id: 'human',
        label: 'Human',
        purpose: 'Input, accountability, approval, rejection, classification. Work a person has to sign for.',
        mode: 'no-agent',
        payload: { executor: 'human' },
      },
      {
        id: 'script',
        label: 'Script',
        purpose: 'Deterministic parsing, validation, conversion, file work, API glue. Same input, same output, every run.',
        mode: 'no-agent',
        payload: { executor: 'script' },
      },
      {
        id: 'action',
        label: 'Action',
        purpose: 'Built-in side effects with no code to maintain: reshape, HTTP call, email, spawn a workflow, wait.',
        mode: 'no-agent',
        payload: { executor: 'action' },
      },
    ],
  },
  {
    id: 'agent',
    label: 'Agent',
    color: 'violet',
    options: [
      {
        id: 'assist',
        label: 'Assist',
        purpose: 'A person does the work and an agent reviews it. Coming soon.',
        mode: 'assist',
        payload: { executor: 'human' },
      },
      {
        id: 'cowork',
        label: 'Cowork',
        purpose: 'Human and agent build the result together in real time, over chat or voice.',
        mode: 'cowork',
        payload: { executor: 'cowork', cowork: { agent: 'chat' } },
      },
      {
        id: 'human-review',
        label: 'Human review',
        purpose: 'Judgment, synthesis, planning, flexible edits. The agent drafts, then a person approves or sends it back before the run continues.',
        mode: 'human-review',
        payload: { executor: 'agent', autonomyLevel: 'L3' },
      },
      {
        id: 'autonomous-agent',
        label: 'Autonomous agent',
        purpose: 'The same agent work with no approval gate. Pick it once the constraints have been approved upstream.',
        mode: 'autonomous-agent',
        payload: { executor: 'agent', autonomyLevel: 'L4' },
      },
    ],
  },
];
