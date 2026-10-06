'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { AgentDefinition, Skill } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { destructiveButtonClass, secondaryButtonClass } from '@/components/ui/button-styles';

/** Confirm and delete a Skill, then return to the Skills list of `handle`, the
 *  workspace being browsed, which for a public Skill is not its own. */
export function DeleteSkillDialog({
  handle,
  skill,
  holders,
  onClose,
}: {
  handle: string;
  skill: Skill;
  holders: AgentDefinition[];
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await mediforce.skills.delete({ namespace: skill.namespace, id: skill.id });
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills(handle) });
      queryClient.removeQueries({ queryKey: queryKeys.skill(skill.namespace, skill.id) });
      router.push(routes.skills(handle));
    } catch (err: unknown) {
      // The refusal names the holding agents the caller can see and counts the rest.
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setDeleting(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (open === false && deleting === false) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete skill
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" disabled={deleting} className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-muted-foreground">
            Delete <span className="font-mono text-foreground">{skill.id}</span> and all its files. This cannot be undone.
          </Dialog.Description>
          {holders.length > 0 && (
            <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              Held by {holders.map((agent) => agent.name).join(', ')}. A skill an agent holds cannot be deleted; remove
              it from {holders.length === 1 ? 'that agent' : 'those agents'} first.
            </p>
          )}
          {error !== null && (
            <div role="alert" className="mt-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={deleting} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="button" onClick={() => void confirm()} disabled={deleting} className={destructiveButtonClass}>
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
