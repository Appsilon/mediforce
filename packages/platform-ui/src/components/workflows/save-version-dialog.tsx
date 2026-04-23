'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SaveVersionDialogProps {
  open: boolean;
  nextVersion: number;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (title: string, setAsDefault: boolean) => void;
}

export function SaveVersionDialog({
  open,
  nextVersion,
  confirmLabel = 'Confirm',
  onClose,
  onConfirm,
}: SaveVersionDialogProps) {
  const [title, setTitle] = useState('');
  const [setAsDefault, setSetAsDefault] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setSetAsDefault(false);
      // Defer focus so the dialog is mounted before we focus
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = title.trim();

  const handleConfirm = () => {
    if (!trimmed) return;
    onConfirm(trimmed, setAsDefault);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog card */}
      <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Name this version</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Give this revision a short, descriptive title so it's easy to identify later.</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Version title</label>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Added AI review step"
            className={cn(
              'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors',
              'focus:ring-2 focus:ring-primary/30 focus:border-primary',
              !trimmed ? 'border-amber-300 dark:border-amber-700' : 'border-border',
            )}
          />
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {trimmed
            ? (
              <>
                Your new workflow version will be saved as{' '}
                <span className="font-mono font-medium text-foreground">v{nextVersion}</span>{' '}
                named <span className="font-medium text-foreground">&ldquo;{trimmed}&rdquo;</span>.
              </>
            )
            : (
              <>
                Enter a title above to name version{' '}
                <span className="font-mono font-medium text-foreground">v{nextVersion}</span>.
              </>
            )
          }
        </p>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={(e) => setSetAsDefault(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <span className="text-xs text-muted-foreground">Set as default version</span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!trimmed}
            className={cn(
              'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
              trimmed ? 'hover:bg-primary/90' : 'opacity-50 cursor-not-allowed',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
