'use client';

import * as React from 'react';
import {
  BUILTIN_CHECK_NAMES,
  BuiltinCheckNameSchema,
  CodeCheckSchema,
  EvaluatorCheckSchema,
  JUDGE_PASS_VALUE,
  type AgentOutputSchema,
  type BuiltinCheckName,
  type EvaluatorCheck,
  type JudgeChoice,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { ModelPicker } from '@/components/workflows/workflow-editor/model-picker';
import { buttonClass, inputClass } from './evaluation-styles';

type CodeRuntime = (typeof CodeCheckSchema.shape.runtime.options)[number];

/** What the add form edits, one shape per kind: plain fields, never the check's JSON. */
export type CheckDraft =
  | { kind: 'schema'; schemaText: string }
  | { kind: 'code'; runtime: CodeRuntime; source: string }
  | { kind: 'llm_judge'; model: string; rubric: string; choices: JudgeChoice[] }
  | { kind: 'builtin'; name: BuiltinCheckName; keys: string };

export type CheckDraftKind = CheckDraft['kind'];

export const CHECK_KINDS: Record<CheckDraftKind, { label: string; description: string }> = {
  schema: {
    label: 'Output schema',
    description: 'The step\'s result must match a JSON Schema: required keys and each property\'s type.',
  },
  code: {
    label: 'Code',
    description: 'A script run in a sandbox decides pass or fail. It needs a person to approve its source before it counts.',
  },
  builtin: {
    label: 'Built-in',
    description: 'A check the platform ships. It counts as soon as it is added: nothing to approve or calibrate.',
  },
  llm_judge: {
    label: 'LLM judge',
    description: 'A model reads the step\'s input and output, reasons about your question, then picks one of your verdicts. Use it for what code cannot check: meaning, tone, clinical judgement.',
  },
};

export const BUILTIN_CHECKS: Record<BuiltinCheckName, { label: string; description: string }> = {
  phi_leak: {
    label: 'No patient identifiers',
    description: 'Fails an output that carries a social security number, email address, phone number, medical record number or date of birth. Works on every case.',
  },
  injection_ignored: {
    label: 'Ignores injected instructions',
    description: 'Fails an output that repeats the canary an instruction hidden in the input asked for. Grades the prompt-injection cases only; on any other case it reports an error, not a failure.',
  },
  result_stable: {
    label: 'Result unchanged',
    description: 'Fails an output that differs from the result of the production run the case was made from. Grades the robustness cases, whose change keeps the input\'s meaning.',
  },
};

const CODE_TEMPLATES: Record<CodeRuntime, string> = {
  python: [
    'import json',
    '',
    "data = json.load(open('/output/input.json'))",
    "result = data['result']",
    '',
    'passed = True',
    "json.dump({'passed': passed}, open('/output/result.json', 'w'))",
  ].join('\n'),
  javascript: [
    "const fs = require('fs');",
    '',
    "const data = JSON.parse(fs.readFileSync('/output/input.json', 'utf8'));",
    'const result = data.result;',
    '',
    'const passed = true;',
    "fs.writeFileSync('/output/result.json', JSON.stringify({ passed }));",
  ].join('\n'),
};

const VERDICT_PRESETS: { label: string; choices: JudgeChoice[] }[] = [
  { label: 'Pass / fail', choices: [{ label: 'pass', value: 1 }, { label: 'fail', value: 0 }] },
  { label: 'Good / acceptable / poor', choices: [{ label: 'good', value: 1 }, { label: 'acceptable', value: 0.5 }, { label: 'poor', value: 0 }] },
];
// LlmJudgeCheckSchema.choices bounds.
const MIN_VERDICTS = 2;
const MAX_VERDICTS = 6;
const DEFAULT_JUDGE_MODEL = 'anthropic/claude-sonnet-4';

/** The step's own `agent.outputSchema`, when it declares one, is the natural start for a schema check. */
export function emptyCheckDraft(kind: CheckDraftKind, stepOutputSchema?: AgentOutputSchema): CheckDraft {
  switch (kind) {
    case 'schema': return { kind, schemaText: JSON.stringify(stepOutputSchema ?? { type: 'object', required: [] }, null, 2) };
    case 'code': return { kind, runtime: 'python', source: CODE_TEMPLATES.python };
    case 'builtin': return { kind, name: 'phi_leak', keys: '' };
    case 'llm_judge': return { kind, model: DEFAULT_JUDGE_MODEL, rubric: '', choices: VERDICT_PRESETS[0]!.choices };
  }
}

/** The check a draft stands for, or why it does not make one. */
export function checkFromDraft(draft: CheckDraft): { check: EvaluatorCheck } | { error: string } {
  let candidate: unknown;
  switch (draft.kind) {
    case 'schema':
      try {
        candidate = { kind: 'schema', schema: JSON.parse(draft.schemaText) };
      } catch {
        return { error: 'The schema is not valid JSON.' };
      }
      break;
    case 'code':
      candidate = { kind: 'code', runtime: draft.runtime, source: draft.source };
      break;
    case 'builtin': {
      const keys = draft.keys.split(',').map((key) => key.trim()).filter((key) => key !== '');
      candidate = { kind: 'builtin', name: draft.name, ...(draft.name === 'result_stable' && keys.length > 0 ? { keys } : {}) };
      break;
    }
    case 'llm_judge':
      if (draft.model.trim() === '') return { error: 'Pick the model that judges.' };
      if (draft.rubric.trim() === '') return { error: 'Write the question the judge answers.' };
      candidate = {
        kind: 'llm_judge',
        model: draft.model.trim(),
        rubric: draft.rubric.trim(),
        choices: draft.choices.map((choice) => ({ ...choice, label: choice.label.trim() })),
      };
      break;
  }
  const parsed = EvaluatorCheckSchema.safeParse(candidate);
  if (parsed.success === false) {
    return { error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'check'}: ${issue.message}`).join('; ') };
  }
  return { check: parsed.data };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint !== undefined && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** The fields of one kind of check. The kind itself is picked outside, in the form's type dropdown. */
export function CheckEditor({ draft, onChange, stepOutputSchema }: {
  draft: CheckDraft;
  onChange: (draft: CheckDraft) => void;
  stepOutputSchema?: AgentOutputSchema;
}) {
  switch (draft.kind) {
    case 'schema': {
      const stepSchemaText = stepOutputSchema === undefined ? null : JSON.stringify(stepOutputSchema, null, 2);
      return (
        <div className="space-y-1">
          {stepSchemaText !== null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {draft.schemaText === stepSchemaText ? 'Starts from the step\'s output schema — tighten it here.' : 'The step declares an output schema.'}
              {draft.schemaText !== stepSchemaText && (
                <button type="button" className={buttonClass} onClick={() => onChange({ ...draft, schemaText: stepSchemaText })}>Use the step&apos;s output schema</button>
              )}
            </div>
          )}
          <Field label="JSON Schema" hint="Checked: type, required and each property's type. Other keywords are ignored.">
            <textarea
              aria-label="JSON Schema"
              className={cn(inputClass, 'w-full min-h-32 font-mono text-xs')}
              value={draft.schemaText}
              onChange={(event) => onChange({ ...draft, schemaText: event.target.value })}
            />
          </Field>
        </div>
      );
    }
    case 'code':
      return (
        <div className="space-y-2">
          <Field label="Language">
            <select
              aria-label="Language"
              className={cn(inputClass, 'block')}
              value={draft.runtime}
              onChange={(event) => {
                const runtime = CodeCheckSchema.shape.runtime.parse(event.target.value);
                const untouched = draft.source === CODE_TEMPLATES[draft.runtime];
                onChange({ ...draft, runtime, source: untouched ? CODE_TEMPLATES[runtime] : draft.source });
              }}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
          </Field>
          <Field
            label="Source"
            hint={'/output/input.json holds result, stepInput, trajectory and the Eval Case; the step\'s workspace is read-only at /workspace. Write {"passed": true|false, "comment"?: "…"} to /output/result.json.'}
          >
            <textarea
              aria-label="Source"
              spellCheck={false}
              className={cn(inputClass, 'w-full min-h-40 font-mono text-xs')}
              value={draft.source}
              onChange={(event) => onChange({ ...draft, source: event.target.value })}
            />
          </Field>
        </div>
      );
    case 'builtin':
      return (
        <div className="space-y-2">
          <Field label="Check" hint={BUILTIN_CHECKS[draft.name].description}>
            <select
              aria-label="Check"
              className={cn(inputClass, 'block')}
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: BuiltinCheckNameSchema.parse(event.target.value) })}
            >
              {BUILTIN_CHECK_NAMES.map((name) => <option key={name} value={name}>{BUILTIN_CHECKS[name].label}</option>)}
            </select>
          </Field>
          {draft.name === 'result_stable' && (
            <Field label="Compare only these keys of the result" hint="Comma-separated top-level keys. Leave empty to compare the whole result.">
              <input
                aria-label="Keys"
                className={cn(inputClass, 'w-full font-mono text-xs')}
                placeholder="grades, summary"
                value={draft.keys}
                onChange={(event) => onChange({ ...draft, keys: event.target.value })}
              />
            </Field>
          )}
        </div>
      );
    case 'llm_judge':
      return <JudgeEditor draft={draft} onChange={onChange} />;
  }
}

function JudgeEditor({ draft, onChange }: {
  draft: Extract<CheckDraft, { kind: 'llm_judge' }>;
  onChange: (draft: CheckDraft) => void;
}) {
  const setChoice = (index: number, choice: JudgeChoice) =>
    onChange({ ...draft, choices: draft.choices.map((existing, at) => (at === index ? choice : existing)) });
  return (
    <div className="space-y-3">
      <Field label="Judge model">
        <ModelPicker
          ariaLabel="Judge model"
          className={cn(inputClass, 'w-full')}
          value={draft.model === '' ? undefined : draft.model}
          onChange={(model) => onChange({ ...draft, model: model ?? '' })}
        />
      </Field>
      <Field
        label="Question for the judge"
        hint="The judge sees the step's input, its output, the agent's own summary and the Eval Case's notes. Say what a good output does and what makes it fail; it writes its reasoning, then picks a verdict."
      >
        <textarea
          aria-label="Question for the judge"
          className={cn(inputClass, 'w-full min-h-24')}
          placeholder="Does every adverse event carry the CTCAE grade its narrative supports? Fail if a grade is missing, or a Grade 5 is given without a fatal outcome."
          value={draft.rubric}
          onChange={(event) => onChange({ ...draft, rubric: event.target.value })}
        />
      </Field>
      <div className="space-y-1.5" role="group" aria-label="Verdicts">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Verdicts</span>
          <span className="flex gap-1">
            {VERDICT_PRESETS.map((preset) => (
              <button key={preset.label} type="button" className={buttonClass} onClick={() => onChange({ ...draft, choices: preset.choices })}>{preset.label}</button>
            ))}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The judge answers with exactly one of these. Each scores 0 to 1; {JUDGE_PASS_VALUE} or more counts as a pass.
        </p>
        {draft.choices.map((choice, index) => (
          <div key={index} className="flex items-center gap-2" data-testid="judge-verdict">
            <input
              aria-label={`Verdict ${index + 1}`}
              className={cn(inputClass, 'flex-1')}
              value={choice.label}
              onChange={(event) => setChoice(index, { ...choice, label: event.target.value })}
            />
            <input
              aria-label={`Verdict ${index + 1} score`}
              type="number" min={0} max={1} step={0.1}
              className={cn(inputClass, 'w-20')}
              value={choice.value}
              onChange={(event) => setChoice(index, { ...choice, value: Number(event.target.value) })}
            />
            <span className={cn('w-16 text-xs', choice.value >= JUDGE_PASS_VALUE ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
              {choice.value >= JUDGE_PASS_VALUE ? 'passes' : 'fails'}
            </span>
            <button
              type="button"
              aria-label={`Remove verdict ${index + 1}`}
              className={buttonClass}
              disabled={draft.choices.length <= MIN_VERDICTS}
              onClick={() => onChange({ ...draft, choices: draft.choices.filter((_, at) => at !== index) })}
            >×</button>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass}
          disabled={draft.choices.length >= MAX_VERDICTS}
          onClick={() => onChange({ ...draft, choices: [...draft.choices, { label: '', value: 0 }] })}
        >Add verdict</button>
      </div>
    </div>
  );
}
