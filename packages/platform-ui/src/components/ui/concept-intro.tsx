import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * States what a concept is before a surface asks the user to configure one.
 * Wrap the definition in <strong> — it renders as the emphasised lead-in.
 */
export function ConceptIntro({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <div className="space-y-1.5 [&_strong]:font-medium [&_strong]:text-foreground">{children}</div>
    </div>
  );
}
