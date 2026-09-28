/**
 * The app's secondary button, in one place.
 *
 * Every toolbar had grown its own: the run page used `px-2.5 py-1 text-xs
 * text-muted-foreground`, the report page `px-3 py-1.5 text-sm font-medium`,
 * and the two sat a click apart looking like different controls. This is the
 * report page's, which is the one we kept.
 */
export const secondaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none';

/** Same shape as the secondary button, for the one destructive action in a
 *  confirmation pair. Filled, so the consequence is not a guess. */
export const destructiveButtonClass =
  'inline-flex items-center gap-1.5 rounded-md border border-transparent bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:pointer-events-none';
