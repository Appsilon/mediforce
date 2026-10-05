'use client';

import * as React from 'react';
import {
  CodeCheckSchema,
  DEFAULT_JUDGE_MIN_CONFIDENCE,
  DEFAULT_MAX_AGREEMENT,
  DEFAULT_MIN_AGREEMENT,
  EvaluatorCheckSchema,
  type AgentOutputSchema,
  type EvalCase,
  type EvaluatorCheck,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { ModelPicker } from '@/components/workflows/workflow-editor/model-picker';
import { buttonClass, inputClass } from './evaluation-styles';

type CodeRuntime = (typeof CodeCheckSchema.shape.runtime.options)[number];

/** What the add form edits, one shape per kind: plain fields, never the check's JSON. */
export type CheckDraft =
  | { kind: 'schema'; schemaText: string }
  | { kind: 'code'; runtime: CodeRuntime; source: string }
  | { kind: 'llm_judge'; model: string; rubric: string; minConfidence: number }
  | { kind: 'expected_output'; model: string; instructions: string; minAgreement: number; maxAgreement: number };

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
  llm_judge: {
    label: 'LLM judge',
    description: 'A model reads the step\'s input, the agent\'s log and its output, explains its judgment, then answers pass or fail with a confidence. Use it for what code cannot check: meaning, tone, clinical judgement.',
  },
  expected_output: {
    label: 'Expected output',
    description: 'Compares the output with each Eval Case\'s expected output, the way the case says: an exact match, where any difference fails, or an agreement score from 0 to 1 that the model below gives. A negative case passes when the output does not match, or agrees no more than the maximum. It grades only cases with an expected output, and never runs in production.',
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

const DEFAULT_JUDGE_MODEL = 'anthropic/claude-sonnet-4';

/** The step's own `agent.outputSchema`, when it declares one, is the natural start for a schema check. */
export function emptyCheckDraft(kind: CheckDraftKind, stepOutputSchema?: AgentOutputSchema): CheckDraft {
  switch (kind) {
    case 'schema': return { kind, schemaText: JSON.stringify(stepOutputSchema ?? { type: 'object', required: [] }, null, 2) };
    case 'code': return { kind, runtime: 'python', source: CODE_TEMPLATES.python };
    case 'llm_judge': return { kind, model: DEFAULT_JUDGE_MODEL, rubric: '', minConfidence: DEFAULT_JUDGE_MIN_CONFIDENCE };
    case 'expected_output': return { kind, model: DEFAULT_JUDGE_MODEL, instructions: '', minAgreement: DEFAULT_MIN_AGREEMENT, maxAgreement: DEFAULT_MAX_AGREEMENT };
  }
}

/** An existing check as the form edits it. */
export function draftFromCheck(check: EvaluatorCheck): CheckDraft {
  switch (check.kind) {
    case 'schema': return { kind: 'schema', schemaText: JSON.stringify(check.schema, null, 2) };
    case 'code': return { kind: 'code', runtime: check.runtime, source: check.source };
    case 'llm_judge': return { kind: 'llm_judge', model: check.model, rubric: check.rubric, minConfidence: check.minConfidence };
    case 'expected_output': return { kind: 'expected_output', model: check.model, instructions: check.instructions ?? '', minAgreement: check.minAgreement, maxAgreement: check.maxAgreement };
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
    case 'llm_judge':
      if (draft.model.trim() === '') return { error: 'Pick the model that judges.' };
      if (draft.rubric.trim() === '') return { error: 'Write the question the judge answers.' };
      candidate = {
        kind: 'llm_judge',
        model: draft.model.trim(),
        rubric: draft.rubric.trim(),
        minConfidence: draft.minConfidence,
      };
      break;
    case 'expected_output':
      if (draft.model.trim() === '') return { error: 'Pick the model that scores agreement.' };
      candidate = {
        kind: 'expected_output',
        model: draft.model.trim(),
        ...(draft.instructions.trim() === '' ? {} : { instructions: draft.instructions.trim() }),
        minAgreement: draft.minAgreement,
        maxAgreement: draft.maxAgreement,
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
          <Field label="JSON Schema" hint="Checked: the required keys and each property's type. Other keywords are ignored.">
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
            hint={'/output/input.json holds result, stepInput, trajectory and case (the Eval Case); the step\'s workspace is read-only at /workspace. Write {"passed": true|false, "comment"?: "…"} to /output/result.json.'}
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
    case 'llm_judge':
      return <JudgeEditor draft={draft} onChange={onChange} />;
    case 'expected_output':
      return <AgreementJudgeEditor draft={draft} onChange={onChange} />;
  }
}

function AgreementJudgeEditor({ draft, onChange }: {
  draft: Extract<CheckDraft, { kind: 'expected_output' }>;
  onChange: (draft: CheckDraft) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Agreement judge model" hint="Scores cases compared by agreement; an exact comparison calls no model.">
        <ModelPicker
          ariaLabel="Agreement judge model"
          className={cn(inputClass, 'w-full')}
          value={draft.model === '' ? undefined : draft.model}
          onChange={(model) => onChange({ ...draft, model: model ?? '' })}
        />
      </Field>
      <Field
        label="Instructions for every case"
        hint="The judge sees only the expected output and the output, plus these and the case's own instructions. Say which differences are trivial and which change what the output means."
      >
        <textarea
          aria-label="Agreement instructions"
          className={cn(inputClass, 'w-full min-h-20')}
          placeholder="Wording and order of free text are trivial. A changed CTCAE grade, term or seriousness flag means low agreement."
          value={draft.instructions}
          onChange={(event) => onChange({ ...draft, instructions: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label="Minimum agreement — positive cases" hint="A positive case passes at this agreement (0 to 1) or above.">
          <input
            aria-label="Minimum agreement for positive cases"
            type="number" min={0} max={1} step={0.05}
            className={cn(inputClass, 'block w-24')}
            value={draft.minAgreement}
            onChange={(event) => onChange({ ...draft, minAgreement: Number(event.target.value) })}
          />
        </Field>
        <Field label="Maximum agreement — negative cases" hint="A negative case passes at this agreement (0 to 1) or below.">
          <input
            aria-label="Maximum agreement for negative cases"
            type="number" min={0} max={1} step={0.05}
            className={cn(inputClass, 'block w-24')}
            value={draft.maxAgreement}
            onChange={(event) => onChange({ ...draft, maxAgreement: Number(event.target.value) })}
          />
        </Field>
      </div>
    </div>
  );
}

function JudgeEditor({ draft, onChange }: {
  draft: Extract<CheckDraft, { kind: 'llm_judge' }>;
  onChange: (draft: CheckDraft) => void;
}) {
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
        hint="The judge sees the step's input, the agent's whole log — its reasoning, tool calls and their results — and its output. Say what a good output does and what makes it fail; it explains what decided its verdict, then answers pass or fail."
      >
        <textarea
          aria-label="Question for the judge"
          className={cn(inputClass, 'w-full min-h-24')}
          placeholder="Does every adverse event carry the CTCAE grade its narrative supports? Fail if a grade is missing, or a Grade 5 is given without a fatal outcome."
          value={draft.rubric}
          onChange={(event) => onChange({ ...draft, rubric: event.target.value })}
        />
      </Field>
      <Field
        label="Minimum confidence"
        hint="A verdict the judge is less confident of (0 to 1) is shown in the report but left out of the Acceptance Criteria, unless a person accepts it."
      >
        <input
          aria-label="Minimum confidence"
          type="number" min={0} max={1} step={0.05}
          className={cn(inputClass, 'block w-24')}
          value={draft.minConfidence}
          onChange={(event) => onChange({ ...draft, minConfidence: Number(event.target.value) })}
        />
      </Field>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{label}</div>
      {children}
    </div>
  );
}

const preClass = 'max-h-64 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap';

/** Everything one check does, read-only; given an Eval Case, only what applies to it. */
export function CheckDetails({ check, evalCase = null }: { check: EvaluatorCheck; evalCase?: Pick<EvalCase, 'comparison' | 'expectation'> | null }) {
  switch (check.kind) {
    case 'schema':
      return <Detail label="JSON Schema"><pre className={preClass}>{JSON.stringify(check.schema, null, 2)}</pre></Detail>;
    case 'code':
      return <Detail label={`Source (${check.runtime === 'python' ? 'Python' : 'JavaScript'})`}><pre className={preClass}>{check.source}</pre></Detail>;
    case 'llm_judge':
      return (
        <div className="space-y-2">
          <Detail label="Judge model"><span className="font-mono">{check.model}</span></Detail>
          <Detail label="Question for the judge"><pre className={cn(preClass, 'font-sans')}>{check.rubric}</pre></Detail>
          <Detail label="Minimum confidence">{check.minConfidence}</Detail>
        </div>
      );
    case 'expected_output':
      if (evalCase?.comparison === 'exact') {
        return <p>The case is compared exactly: a field-by-field comparison in code, with no model.</p>;
      }
      return (
        <div className="space-y-2">
          <Detail label="Agreement judge model"><span className="font-mono">{check.model}</span></Detail>
          {check.instructions !== undefined && <Detail label="Instructions for every case"><pre className={cn(preClass, 'font-sans')}>{check.instructions}</pre></Detail>}
          {evalCase?.expectation !== 'negative' && <Detail label="Minimum agreement — positive cases">{check.minAgreement}</Detail>}
          {evalCase?.expectation !== 'positive' && <Detail label="Maximum agreement — negative cases">{check.maxAgreement}</Detail>}
        </div>
      );
  }
}
