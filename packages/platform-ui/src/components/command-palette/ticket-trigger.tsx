'use client';

import { TicketPlus } from 'lucide-react';
import { useCommandPalette } from './provider';

/** Top-bar affordance for filing a ticket. Opens the palette straight on the
 *  `new-ticket` view — the palette's own back arrow leads to the full command
 *  list, so the list stays reachable without a second header button. */
export function NewTicketTrigger() {
  const { openCommand } = useCommandPalette();

  return (
    <button
      onClick={() => openCommand('new-ticket')}
      className="inline-flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="File a ticket"
      data-testid="new-ticket-trigger"
    >
      <TicketPlus className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Ticket</span>
    </button>
  );
}
