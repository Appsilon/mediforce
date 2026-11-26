'use client';

import { useState, useEffect, useRef } from 'react';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NameWorkflowDialogProps {
  open: boolean;
  name: string;
  description: string;
  onClose: () => void;
  onConfirm: (name: string, description: string) => void;
}

export function NameWorkflowDialog({ open, name, description, onClose, onConfirm }: NameWorkflowDialogProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraftName(name);
      setDraftDescription(description);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, name, description]);

  if (!open) return null;

  const trimmedName = draftName.trim();
  const trimmedDescription = draftDescription.trim();
  const canConfirm = trimmedName !== '' && trimmedDescription !== '';

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmedName, trimmedDescription);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <h2 className="text-sm font-semibold">Name your workflow</h2>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Workflow name</label>
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            placeholder="Clinical trials workflow..."
            className={cn(
              'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors',
              'focus:ring-2 focus:ring-primary/30 focus:border-primary',
              trimmedName === '' ? 'border-amber-300 dark:border-amber-700' : 'border-border',
            )}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Short description of your workflow..."
            rows={3}
            className={cn(
              'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors resize-none',
              'focus:ring-2 focus:ring-primary/30 focus:border-primary',
              trimmedDescription === '' ? 'border-amber-300 dark:border-amber-700' : 'border-border',
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
              canConfirm ? 'hover:bg-primary/90' : 'opacity-50 cursor-not-allowed',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            Save Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
