'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { z } from 'zod';
import { cn } from '@/lib/utils';
import { textareaBase } from './step-editor-fields';

/**
 * JSON Schema textarea shared by `cowork.outputSchema` and `agent.outputSchema`.
 * Commits on blur: blank clears the field, text that is not JSON or does not
 * fit `schema` stays in the box with the error under it.
 */
export function OutputSchemaEditor<Schema extends Record<string, unknown>>({
  value,
  onChange,
  schema,
}: {
  value: Schema | undefined;
  onChange: (schema: Schema | undefined) => void;
  schema: z.ZodType<Schema>;
}) {
  const [draft, setDraft] = useState(() => value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  const valueRef = useRef(value);
  useEffect(() => {
    if (value !== valueRef.current) {
      valueRef.current = value;
      setDraft(value !== undefined ? JSON.stringify(value, null, 2) : '');
      setError(null);
    }
  }, [value]);

  const handleBlur = () => {
    if (draft.trim() === '') { onChange(undefined); setError(null); return; }
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(draft); }
    catch { setError('Invalid JSON'); return; }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue === undefined ? 'Invalid schema' : `${issue.path.join('.') || 'schema'}: ${issue.message}`);
      return;
    }
    onChange(parsed.data);
    setError(null);
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
    </div>
  );
}
