import type { WorkflowStep } from '../schemas/workflow-definition';

/**
 * Pre-made blocks — the "Simple" tier of the Add Block picker.
 *
 * A preset is the capability-shaped counterpart to the control-mode rows the
 * picker already offers: it answers "what do you want to do" and emits a step
 * that is already structurally correct, rather than asking the author to pick
 * an executor and then fill an empty config by hand.
 *
 * This lives in platform-core, not the UI, because the workflow assistant
 * builds steps from the same catalog — one source of truth for what a
 * "Send email" block is.
 *
 * Presets deliberately do NOT invent author-specific values (a recipient, a
 * URL, a target workflow). Those are declared in `needsInput` and left empty;
 * the editor's existing step-error highlighting surfaces them.
 *
 * No preset emits `type: 'review'`. Those steps keep working for existing
 * workflows, but the picker stops offering the type for new ones per ADR-0006;
 * approval belongs on an agent step at L3 ("Agent drafts, person approves").
 */

/** Capabilities an instance may or may not have wired up. */
export const BLOCK_CAPABILITY_KEYS = ['email', 'agents'] as const;

export type BlockCapabilityKey = (typeof BLOCK_CAPABILITY_KEYS)[number];

export const BLOCK_CATEGORIES = ['people', 'communicate', 'data', 'ai', 'control'] as const;

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

/**
 * The step fields a preset contributes. `type` is included because a pre-made
 * block already knows whether it creates a result or routes — unlike the
 * control-mode tier, where a separate toggle supplies it.
 */
export type BlockPresetPayload = Partial<Omit<WorkflowStep, 'id'>> & {
  type: WorkflowStep['type'];
  executor: WorkflowStep['executor'];
};

export type BlockPreset = {
  /** Stable identifier — React key, test hook, and the assistant's handle. */
  id: string;
  label: string;
  /** When to reach for this block, in the author's language. */
  purpose: string;
  category: BlockCategory;
  payload: BlockPresetPayload;
  /** Capability the instance must have. Undefined means always available. */
  requires?: BlockCapabilityKey;
  /**
   * Dotted paths the author must fill before the step can be saved. The picker
   * cannot know these — they are specific to the workflow being built.
   */
  needsInput?: string[];
};

export const BLOCK_PRESETS: BlockPreset[] = [
  {
    id: 'collect-input',
    label: 'Collect input',
    purpose: 'Ask a person for the values the rest of the workflow needs.',
    category: 'people',
    payload: {
      type: 'creation',
      executor: 'human',
      params: [
        { name: 'notes', type: 'textarea', required: true, description: 'What the workflow needs from you' },
      ],
    },
  },
  {
    id: 'send-email',
    label: 'Send email',
    purpose: 'Notify someone. The instance decides how it is delivered.',
    category: 'communicate',
    requires: 'email',
    needsInput: ['action.config.to'],
    payload: {
      type: 'creation',
      executor: 'action',
      action: {
        kind: 'email',
        config: {
          to: '',
          subject: 'Workflow update',
          body: 'This workflow has an update for you.',
        },
      },
    },
  },
  {
    id: 'run-script',
    label: 'Run a Python script',
    purpose: 'Deterministic parsing, validation, or file work. Same input, same output, every run.',
    category: 'data',
    payload: {
      type: 'creation',
      executor: 'script',
      plugin: 'script-container',
      script: {
        runtime: 'python',
        inlineScript: [
          'import json',
          '',
          'with open("/output/input.json") as handle:',
          '    step_input = json.load(handle)',
          '',
          'result = {"ok": True}',
          '',
          'with open("/output/result.json", "w") as handle:',
          '    json.dump(result, handle)',
        ].join('\n'),
      },
    },
  },
  {
    id: 'call-api',
    label: 'Call an API',
    purpose: 'One HTTP request, no container to maintain.',
    category: 'data',
    needsInput: ['action.config.url'],
    payload: {
      type: 'creation',
      executor: 'action',
      action: { kind: 'http', config: { method: 'GET', url: '' } },
    },
  },
  {
    id: 'transform-data',
    label: 'Transform data',
    purpose: 'Reshape earlier results into the shape the next step expects.',
    category: 'data',
    payload: {
      type: 'creation',
      executor: 'action',
      action: { kind: 'reshape', config: { values: {} } },
    },
  },
  {
    id: 'agent-drafts-person-approves',
    label: 'Agent drafts, person approves',
    purpose: 'Judgment or synthesis, with a human gate before the run continues.',
    category: 'ai',
    requires: 'agents',
    payload: {
      type: 'creation',
      executor: 'agent',
      autonomyLevel: 'L3',
    },
  },
  {
    id: 'work-with-an-agent-live',
    label: 'Work with an agent live',
    purpose: 'A person and an agent build the result together, over chat.',
    category: 'ai',
    requires: 'agents',
    payload: {
      type: 'creation',
      executor: 'cowork',
      cowork: { agent: 'chat' },
    },
  },
  {
    id: 'route-by-condition',
    label: 'Route by condition',
    purpose: 'Send the run down different paths based on earlier results.',
    category: 'control',
    payload: {
      type: 'decision',
      executor: 'human',
    },
  },
  {
    id: 'wait',
    label: 'Wait',
    purpose: 'Pause before continuing, for a delay, a deadline, or a condition.',
    category: 'control',
    payload: {
      type: 'creation',
      executor: 'action',
      action: { kind: 'wait', config: { duration: { minutes: 5 } } },
    },
  },
  {
    id: 'run-another-workflow',
    label: 'Run another workflow',
    purpose: 'Start another workflow, once or over a list.',
    category: 'control',
    needsInput: ['action.config.targets.definitionName'],
    payload: {
      type: 'creation',
      executor: 'action',
      action: {
        kind: 'spawn',
        config: { targets: { definitionName: '' }, continueOnSpawnError: true },
      },
    },
  },
];
