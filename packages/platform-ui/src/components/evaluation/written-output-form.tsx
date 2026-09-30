'use client';

import * as React from 'react';
import type { AgentOutputSchema, AgentRun, EvaluatedStep } from '@mediforce/platform-core';
import type { EvaluatorView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useAgentRunIo, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

type JsonObject = Record<string, unknown>;
type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'json';

interface Field {
  key: string;
  type: FieldType;
  required: boolean;
  options: readonly string[] | null;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && Array.isArray(value) === false;
}

/** The fields an output has: the step's `outputSchema` properties in order, then any other key the output carries. */
export function outputFields(schema: AgentOutputSchema | undefined, value: JsonObject): Field[] {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const declared = Object.entries(properties).map(([key, property]): Field => {
    const enumValues = (property as { enum?: unknown }).enum;
    const options = Array.isArray(enumValues) && enumValues.every((option) => typeof option === 'string') ? enumValues : null;
    const type = property.type === 'string' || property.type === 'number' || property.type === 'integer' || property.type === 'boolean' ? property.type : 'json';
    return { key, type, required: required.has(key), options };
  });
  const extra = Object.keys(value).filter((key) => !(key in properties)).map((key): Field => {
    const current = value[key];
    const type: FieldType = typeof current === 'string' ? 'string' : typeof current === 'number' ? 'number' : typeof current === 'boolean' ? 'boolean' : 'json';
    return { key, type, required: false, options: null };
  });
  return [...declared, ...extra];
}

/** An output shaped like the schema, with every field empty — for an example written from nothing. */
export function emptyOutput(schema: AgentOutputSchema | undefined): JsonObject {
  return Object.fromEntries(outputFields(schema, {}).map((field) => [field.key, {
    string: '', number: 0, integer: 0, boolean: false, json: null,
  }[field.type]]));
}

/** Where two outputs differ, as `path: before → after` for each changed value, deepest first. */
export function describeChanges(before: unknown, after: unknown, path = ''): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => describeChanges(before[key], after[key], path === '' ? key : `${path}.${key}`));
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, index) => describeChanges(item, after[index], `${path}[${index}]`));
  }
  const show = (value: unknown) => (value === undefined ? '(none)' : JSON.stringify(value));
  return [`${path === '' ? 'output' : path}: ${show(before)} → ${show(after)}`];
}

function JsonField({ value, onChange, label }: { value: unknown; onChange: (value: unknown) => void; label: string }) {
  const [text, setText] = React.useState(JSON.stringify(value, null, 2));
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div>
      <textarea
        aria-label={label}
        className={cn(inputClass, 'w-full min-h-20 font-mono text-xs')}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(JSON.parse(event.target.value));
            setError(null);
          } catch {
            setError('Not valid JSON yet — the last valid value is kept.');
          }
        }}
      />
      {error !== null && <p className="text-amber-700 dark:text-amber-300">{error}</p>}
    </div>
  );
}

/**
 * The step's output as a form: one field per property of its `outputSchema`,
 * typed by it, so an edited output keeps the shape the step returns. Fields
 * changed from `base` are marked and can be reset.
 */
export function OutputEditor({ schema, base, value, onChange }: {
  schema: AgentOutputSchema | undefined;
  base: JsonObject | null;
  value: JsonObject;
  onChange: (value: JsonObject) => void;
}) {
  const [asJson, setAsJson] = React.useState(false);
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  if (asJson) {
    return (
      <div className="space-y-1">
        <JsonField label="Output as JSON" value={value} onChange={(next) => { if (isObject(next)) onChange(next); }} />
        <button type="button" className={buttonClass} onClick={() => setAsJson(false)}>Edit as fields</button>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="output-editor">
      {outputFields(schema, value).map((field) => {
        const current = value[field.key];
        const changed = base !== null && JSON.stringify(base[field.key]) !== JSON.stringify(current);
        const label = `Output field ${field.key}`;
        return (
          <div key={field.key} className={cn('rounded border p-1.5', changed && 'border-amber-500/60 bg-amber-500/5')} data-testid="output-field">
            <div className="mb-0.5 flex items-center gap-1.5">
              <span className="font-mono font-medium">{field.key}</span>
              {field.required && <span className="text-muted-foreground">required</span>}
              {changed && (
                <>
                  <span className="text-amber-700 dark:text-amber-300">changed</span>
                  <button type="button" className="ml-auto text-muted-foreground underline" onClick={() => set(field.key, base[field.key])}>Reset</button>
                </>
              )}
            </div>
            {field.options !== null ? (
              <select aria-label={label} className={inputClass} value={String(current ?? '')} onChange={(event) => set(field.key, event.target.value)}>
                {[...new Set([...field.options, String(current ?? '')])].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : field.type === 'string' ? (
              <textarea aria-label={label} className={cn(inputClass, 'w-full min-h-10 text-xs')} value={typeof current === 'string' ? current : ''} onChange={(event) => set(field.key, event.target.value)} />
            ) : field.type === 'number' || field.type === 'integer' ? (
              <input
                aria-label={label}
                type="number"
                step={field.type === 'integer' ? 1 : 'any'}
                className={cn(inputClass, 'w-32')}
                value={typeof current === 'number' ? current : ''}
                onChange={(event) => set(field.key, event.target.value === '' ? null : Number(event.target.value))}
              />
            ) : field.type === 'boolean' ? (
              <select aria-label={label} className={inputClass} value={String(current === true)} onChange={(event) => set(field.key, event.target.value === 'true')}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <JsonField key={JSON.stringify(base?.[field.key] ?? null)} label={label} value={current ?? null} onChange={(next) => set(field.key, next)} />
            )}
          </div>
        );
      })}
      <button type="button" className={buttonClass} onClick={() => setAsJson(true)}>Edit as JSON</button>
    </div>
  );
}

const FROM_NOTHING = '';

/**
 * Writing an example output for a judge (ADR-0023 D9): started from a real
 * run — its input as it was, its output to change — and saved labelled pass
 * or fail for the judge's rule in one step.
 */
export function WriteOutputForm({ step, evaluator, runs, stepOutputSchema, onClose }: {
  step: EvaluatedStep;
  evaluator: EvaluatorView;
  runs: readonly AgentRun[];
  stepOutputSchema: AgentOutputSchema | undefined;
  onClose: () => void;
}) {
  const [runId, setRunId] = React.useState<string>(runs[0]?.id ?? FROM_NOTHING);
  const io = useAgentRunIo(runId === FROM_NOTHING ? null : runId);
  const base = runId === FROM_NOTHING ? null : isObject(io.data?.result) ? io.data.result : null;
  const loading = runId !== FROM_NOTHING && io.data === undefined && io.isError === false;
  return (
    <div className="space-y-2 rounded-md border bg-background p-2.5" data-testid="write-output">
      <p className="text-muted-foreground">
        Take a real run and change its output the way this rule should catch — a wrong value, a missing justification — then say whether it passes. The input stays what the run was given.
      </p>
      <label className="flex items-center gap-1">Start from
        <select aria-label="Start from run" className={inputClass} value={runId} onChange={(event) => setRunId(event.target.value)}>
          {runs.map((run) => <option key={run.id} value={run.id}>run {run.id.slice(0, 8)} · {run.startedAt.slice(0, 16).replace('T', ' ')}</option>)}
          <option value={FROM_NOTHING}>Nothing — write the input and output</option>
        </select>
      </label>
      {loading ? <p className="text-muted-foreground">Loading the run&apos;s output…</p> : (
        <WriteOutputFields
          key={runId}
          step={step}
          evaluator={evaluator}
          basedOnAgentRunId={runId === FROM_NOTHING ? null : runId}
          stepInput={runId === FROM_NOTHING ? null : io.data?.stepInput ?? null}
          base={base}
          stepOutputSchema={stepOutputSchema}
          onSaved={onClose}
          onCancel={onClose}
        />
      )}
    </div>
  );
}

/**
 * The output being written, its note, and saving it labelled. `initial` starts
 * the output from a draft instead of the run's own; `origin` marks a draft the
 * assistant wrote; `onSaved` hears which label it was saved with.
 */
export function WriteOutputFields({ step, evaluator, basedOnAgentRunId, stepInput, base, stepOutputSchema, initial, initialNote = '', origin = 'user', collapsedEditor = false, onSaved, onCancel }: {
  step: EvaluatedStep;
  evaluator: Pick<EvaluatorView, 'id'>;
  basedOnAgentRunId: string | null;
  stepInput: JsonObject | null;
  base: JsonObject | null;
  stepOutputSchema: AgentOutputSchema | undefined;
  initial?: JsonObject;
  initialNote?: string;
  origin?: 'user' | 'assistant';
  collapsedEditor?: boolean;
  onSaved: (passed: boolean) => void;
  onCancel?: () => void;
}) {
  const [result, setResult] = React.useState<JsonObject>(initial ?? base ?? emptyOutput(stepOutputSchema));
  const [inputText, setInputText] = React.useState('{}');
  const [note, setNote] = React.useState(initialNote);
  const [error, setError] = React.useState<string | null>(null);
  const save = useStepEvaluationMutation(step, (passed: boolean) => {
    let writtenInput: JsonObject | null = null;
    if (basedOnAgentRunId === null) {
      const parsed: unknown = JSON.parse(inputText);
      if (!isObject(parsed)) throw new Error('The input must be a JSON object.');
      writtenInput = parsed;
    }
    return mediforce.evaluation.createWrittenOutput({
      ...step,
      result,
      ...(basedOnAgentRunId === null ? { stepInput: writtenInput } : { basedOnAgentRunId }),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
      origin,
      label: { evaluatorId: evaluator.id, passed },
    });
  });
  const changes = base === null ? [] : describeChanges(base, result);
  const submit = (passed: boolean) => {
    setError(null);
    save.mutate(passed, { onSuccess: () => onSaved(passed), onError: (err) => setError(err instanceof SyntaxError ? 'The input is not valid JSON.' : err.message) });
  };
  return (
    <div className="space-y-2">
      {basedOnAgentRunId === null ? (
        <label className="block space-y-0.5">
          <span className="text-muted-foreground">Input the step is given (JSON)</span>
          <textarea aria-label="Written input" className={cn(inputClass, 'w-full min-h-20 font-mono text-xs')} spellCheck={false} value={inputText} onChange={(event) => setInputText(event.target.value)} />
        </label>
      ) : (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Input the run was given</summary>
          <pre className="mt-0.5 max-h-48 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap break-words" data-testid="write-output-input">{JSON.stringify(stepInput, null, 2)}</pre>
        </details>
      )}
      {collapsedEditor ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Edit the output</summary>
          <div className="mt-1"><OutputEditor schema={stepOutputSchema} base={base} value={result} onChange={setResult} /></div>
        </details>
      ) : (
        <>
          <div className="font-medium">Output</div>
          <OutputEditor schema={stepOutputSchema} base={base} value={result} onChange={setResult} />
        </>
      )}
      {base !== null && (
        <p className={changes.length === 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'} data-testid="write-output-changes">
          {changes.length === 0 ? 'Nothing changed yet — this is the run\'s own output; label the run itself instead.' : `Changed: ${changes.slice(0, 5).join('; ')}${changes.length > 5 ? ` and ${changes.length - 5} more` : ''}`}
        </p>
      )}
      <input aria-label="Note" className={cn(inputClass, 'w-full text-xs')} placeholder="What is wrong with it, or what it shows (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
      {error !== null && <p className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={primaryButtonClass} disabled={save.isPending} onClick={() => submit(false)}>Save as fail</button>
        <button type="button" className={buttonClass} disabled={save.isPending} onClick={() => submit(true)}>Save as pass</button>
        {onCancel !== undefined && <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

/** One output the assistant drafted: why, what it changed from its run, and the person's label. */
export function DraftedOutput({ step, evaluatorId, draft, stepOutputSchema, mayEdit }: {
  step: EvaluatedStep;
  evaluatorId: string;
  draft: { basedOnAgentRunId: string; result: JsonObject; why: string };
  stepOutputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
}) {
  const io = useAgentRunIo(draft.basedOnAgentRunId);
  const [saved, setSaved] = React.useState<boolean | null>(null);
  const base = isObject(io.data?.result) ? io.data.result : null;
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0" data-testid="drafted-output">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">from run <span className="font-mono">{draft.basedOnAgentRunId.slice(0, 8)}</span></span>
        {saved !== null && (
          <span className={cn('rounded px-1.5 text-[11px]', saved ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>
            saved, labelled {saved ? 'pass' : 'fail'}
          </span>
        )}
      </div>
      <p>{draft.why}</p>
      {io.data === undefined ? <p className="text-muted-foreground">Loading the run&apos;s output…</p> : saved === null && mayEdit ? (
        <WriteOutputFields
          step={step}
          evaluator={{ id: evaluatorId }}
          basedOnAgentRunId={draft.basedOnAgentRunId}
          stepInput={io.data.stepInput}
          base={base}
          stepOutputSchema={stepOutputSchema}
          initial={draft.result}
          initialNote={draft.why}
          origin="assistant"
          collapsedEditor
          onSaved={setSaved}
        />
      ) : (
        <p className="text-muted-foreground">Changed: {describeChanges(base, draft.result).slice(0, 5).join('; ')}</p>
      )}
    </li>
  );
}
