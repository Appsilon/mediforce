'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import type { AgentStepChange } from '@mediforce/platform-core';
import { destructiveButtonClass, secondaryButtonClass } from '@/components/ui/button-styles';

/**
 * Confirms a change that makes a step stop running its validated agent as it
 * was validated: the step then loses the agent's validation and needs its own
 * (ADR-0029 D8).
 */
export function ModifyValidatedAgentDialog({ agentName, changes, open, onCancel, onConfirm }: {
  agentName: string;
  changes: AgentStepChange[];
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (isOpen === false) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            This step reuses a validated agent
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {agentName} is validated as it is. Changing its {changes.join(', ')} in this step means the step no longer
            runs the validated agent, so it is no longer validated. Validate the step on the workflow&apos;s Evaluation
            tab before relying on it.
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="button" onClick={onConfirm} className={destructiveButtonClass}>
              Change anyway
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
