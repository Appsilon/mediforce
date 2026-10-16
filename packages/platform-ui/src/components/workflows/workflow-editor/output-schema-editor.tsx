'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { z } from 'zod';
import { cn } from '@/lib/utils';
import { textareaBase } from './step-editor-fields';

function schemaText(schema: Record<string, unknown> | undefined): string {
  return schema !== undefined ? JSON.stringify(schema, null, 2) : '';
}

/**
 * JSON Schema textarea shared by `cowork.outputSchema` and `agent.outputSchema`.
 * Commits on blur: blank clears the field, text that is not JSON or does not
 * fit `schema` stays in the box with the error under it. With `inherited`,
 * an unset field shows the schema it falls back to, and committing that
 * schema unchanged keeps the field unset.
 */
export function OutputSchemaEditor<Schema extends Record<string, unknown>>({
  value,
  onChange,
  schema,
  inherited,
}: {
  value: Schema | undefined;
  onChange: (schema: Schema | undefined) => void;
  schema: z.ZodType<Schema>;
  inherited?: { schema: Schema; from: string };
}) {
  const shownText = schemaText(value ?? inherited?.schema);
  const [draft, setDraft] = useState(shownText);
  const [error, setError] = useState<string | null>(null);

  const shownRef = useRef(shownText);
  useEffect(() => {
    if (shownText !== shownRef.current) {
      shownRef.current = shownText;
      setDraft(shownText);
      setError(null);
    }
  }, [shownText]);

  const handleBlur = () => {
    if (draft.trim() === '') { onChange(undefined); setDraft(schemaText(inherited?.schema)); setError(null); return; }
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(draft); }
    catch { setError('Invalid JSON'); return; }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue === undefined ? 'Invalid schema' : `${issue.path.join('.') || 'schema'}: ${issue.message}`);
      return;
    }
    setError(null);
    const isInherited = inherited !== undefined && schemaText(parsed.data) === schemaText(inherited.schema);
    if (isInherited === false) onChange(parsed.data);
    else if (value !== undefined) onChange(undefined);
  };

  return (
    <div className="w-full">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        rows={5}
        placeholder={'{\n  "type": "object",\n  "required": [],\n  "properties": {}\n}'}
        className={cn(
          textareaBase, 'font-mono text-[11px]',
          error ? 'border-destructive ring-1 ring-destructive' : '',
        )}
      />
      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
      {inherited !== undefined && (value === undefined ? (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Inherited from {inherited.from}. Edit it to give this step a schema of its own.
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Replaces {inherited.from}&apos;s schema.{' '}
          <button type="button" onClick={() => onChange(undefined)} className="underline hover:text-foreground">
            Use {inherited.from}&apos;s schema
          </button>
        </p>
      ))}
    </div>
  );
}
