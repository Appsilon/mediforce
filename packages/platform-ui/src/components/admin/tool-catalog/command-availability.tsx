'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useImageCatalogEntries, useImageCommandCheck } from '@/hooks/use-image-catalog';
import { commandCheckImages, describeCommandCheck } from './command-check';

const TYPING_DEBOUNCE_MS = 400;

/** Checks a command against an image the author picks, defaulting to the one
 *  an agent step falls back to — so a command the default image lacks is
 *  flagged as it is typed, and the author can look for an image that has it. */
export function CommandAvailability({ namespace, command }: { namespace: string; command: string }) {
  const { entries } = useImageCatalogEntries(namespace);
  const images = commandCheckImages(entries);
  const [image, setImage] = useState(images[0]?.value ?? '');
  const [debouncedCommand, setDebouncedCommand] = useState(command.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommand(command.trim()), TYPING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [command]);

  const check = useImageCommandCheck(namespace, image, debouncedCommand);
  if (debouncedCommand === '') return null;

  const message = check.data !== undefined
    ? describeCommandCheck(check.data, debouncedCommand)
    : check.error !== null
      ? describeCommandCheck({ status: 'unknown' }, debouncedCommand)
      : undefined;

  return (
    <div className="flex flex-col gap-1.5 text-xs" data-testid="command-availability">
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-muted-foreground">Check availability in</span>
        <select
          value={image}
          onChange={(event) => setImage(event.target.value)}
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          {images.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {check.isFetching === true && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking…
        </p>
      )}
      {check.isFetching === false && message !== undefined && (
        <p
          role={message.tone === 'warning' ? 'alert' : undefined}
          className={cn(
            'flex items-start gap-1.5',
            message.tone === 'warning' && 'text-amber-600 dark:text-amber-400',
            message.tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
            message.tone === 'muted' && 'text-muted-foreground',
          )}
        >
          {message.tone === 'warning' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
          {message.tone === 'ok' && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
          <span>{message.text}</span>
        </p>
      )}
    </div>
  );
}
