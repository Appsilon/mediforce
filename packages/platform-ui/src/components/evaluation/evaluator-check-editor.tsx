'use client';

import * as React from 'react';
import {
  CodeCheckSchema,
  EvaluatorCheckSchema,
  type EvaluatorCheck,
  type JudgeChoice,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { inputClass } from './evaluation-styles';

type CodeRuntime = (typeof CodeCheckSchema.shape.runtime.options)[number];

/** What the add form edits, one shape per kind: plain fields, never the check's JSON. */
export type CheckDraft =
  | { kind: 'schema'; schemaText: string }
  | { kind: 'code'; runtime: CodeRuntime; source: string }
  | { kind: 'llm_judge'; model: string; rubric: string; choices: JudgeChoice[] };

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
    description: 'A model reads the step\'s input and output and answers a question about it.',
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

const PASS_FAIL: JudgeChoice[] = [{ label: 'pass', value: 1 }, { label: 'fail', value: 0 }];

export function emptyCheckDraft(kind: CheckDraftKind): CheckDraft {
  switch (kind) {
    case 'schema': return { kind, schemaText: JSON.stringify({ type: 'object', required: [] }, null, 2) };
    case 'code': return { kind, runtime: 'python', source: CODE_TEMPLATES.python };
    case 'llm_judge': return { kind, model: '', rubric: '', choices: PASS_FAIL };
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
      candidate = { kind: 'llm_judge', model: draft.model.trim(), rubric: draft.rubric.trim(), choices: draft.choices };
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
export function CheckEditor({ draft, onChange }: { draft: CheckDraft; onChange: (draft: CheckDraft) => void }) {
  switch (draft.kind) {
    case 'schema':
      return (
        <Field label="JSON Schema" hint="Checked: type, required and each property's type. Other keywords are ignored.">
          <textarea
            aria-label="JSON Schema"
            className={cn(inputClass, 'w-full min-h-32 font-mono text-xs')}
            value={draft.schemaText}
            onChange={(event) => onChange({ ...draft, schemaText: event.target.value })}
          />
        </Field>
      );
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
    case 'llm_judge':
      return (
        <div className="space-y-2">
          <Field label="Model">
            <input aria-label="Model" className={cn(inputClass, 'w-full')} value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} />
          </Field>
          <Field label="Rubric">
            <textarea aria-label="Rubric" className={cn(inputClass, 'w-full min-h-24')} value={draft.rubric} onChange={(event) => onChange({ ...draft, rubric: event.target.value })} />
          </Field>
        </div>
      );
  }
}
