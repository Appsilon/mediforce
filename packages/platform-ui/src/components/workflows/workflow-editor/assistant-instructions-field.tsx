'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, FileText, Loader2 } from 'lucide-react';
import { WORKFLOW_ASSISTANT_INSTRUCTIONS_MAX_CHARS } from '@mediforce/platform-core';
import {
  useAssistantInstructions,
  useSetAssistantInstructions,
} from '@/hooks/use-assistant-instructions';
import { useToast } from '@/components/command-palette';
import { cn } from '@/lib/utils';

/**
 * The standing instructions this person keeps for the assistant in this
 * workspace — how *they* want workflows built, read by every turn here.
 *
 * Saved on blur rather than behind a button: there is one field and one value,
 * and a Save nobody pressed is the commonest way a setting like this silently
 * does nothing.
 */
export function AssistantInstructionsField({ namespace }: { namespace: string }) {
  const { toast } = useToast();
  const { instructions, loading, error, retry } = useAssistantInstructions(namespace);
  const setInstructions = useSetAssistantInstructions(namespace);
  const [draft, setDraft] = useState(instructions);
  const [open, setOpen] = useState(false);
  const textareaId = useId();
  const previousNamespace = useRef(namespace);

  // The server's answer is the starting text, and it arrives after the first
  // render. Adopting it only while the field is pristine keeps a late response
  // from overwriting something already being typed.
  useEffect(() => {
    if (previousNamespace.current !== namespace) {
      previousNamespace.current = namespace;
      setDraft(loading ? '' : instructions);
      return;
    }
    setDraft((current) => (current === '' ? instructions : current));
  }, [instructions, loading, namespace]);

  const save = useCallback(() => {
    if (draft === instructions) return;
    setInstructions.mutate(draft, {
      onError: (err: Error) => {
        toast({
          variant: 'error',
          title: 'Could not save your assistant instructions',
          description: err.message,
        });
      },
    });
  }, [draft, instructions, setInstructions, toast]);

  const remaining = WORKFLOW_ASSISTANT_INSTRUCTIONS_MAX_CHARS - draft.length;
  const fieldDisabled = loading || error !== null || setInstructions.isPending;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={open ? 'Hide your instructions' : 'Show your instructions'}
          aria-expanded={open}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={open ? 'Hide your instructions' : 'Show your instructions'}
        >
          <FileText className="h-4 w-4" />
        </button>
        {open && setInstructions.isPending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {open && !setInstructions.isPending && setInstructions.isSuccess && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>
      {open && (
        <>
          {error !== null && (
            <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
              <span>Could not load your instructions.</span>
              <button
                type="button"
                onClick={retry}
                aria-label="Retry loading your instructions"
                className="rounded-md px-1.5 py-0.5 text-xs font-medium hover:bg-muted"
              >
                Retry
              </button>
            </div>
          )}
          <label htmlFor={textareaId} className="text-xs font-medium text-muted-foreground">
            Your instructions
          </label>
          <textarea
            id={textareaId}
            value={draft}
            disabled={fieldDisabled}
            maxLength={WORKFLOW_ASSISTANT_INSTRUCTIONS_MAX_CHARS}
            onChange={(event) => { setDraft(event.target.value); }}
            onBlur={save}
            rows={5}
            placeholder="How you want workflows built here — naming, defaults, the shapes you always reach for. Every turn in this workspace reads this."
            className={cn(
              'w-full rounded-md border bg-background px-2 py-1.5 text-xs leading-relaxed',
              'focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50',
            )}
          />
          <p className="text-[11px] text-muted-foreground">
            {remaining < 500
              ? `${String(remaining)} characters left.`
              : 'Private to you, kept between sessions.'}
          </p>
        </>
      )}
    </div>
  );
}
