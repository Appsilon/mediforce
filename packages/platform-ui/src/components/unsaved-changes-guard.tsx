'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';

/**
 * Resolves the in-app destination a click is about to navigate to, or null when
 * the click is not an in-app navigation the App Router will handle (modified
 * click, new tab, download, external host, same page, plain anchor target).
 */
function inAppDestination(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  const target = event.target;
  const anchor = target instanceof Element ? target.closest('a') : null;
  if (anchor === null || anchor.hasAttribute('download')) return null;
  if (anchor.target !== '' && anchor.target !== '_self') return null;

  const href = anchor.getAttribute('href');
  if (href === null || href.startsWith('#')) return null;

  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) return null;
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) return null;

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

/**
 * Confirms before unsaved editor state is thrown away. Covers the two ways a
 * user leaves a page: an in-app link (breadcrumbs, sidebar — intercepted in the
 * capture phase, before Next's Link handler sees the click) and leaving the tab
 * entirely (`beforeunload`).
 *
 * Browser Back is deliberately not intercepted: the App Router has no
 * navigation-blocking API, and the history-sentinel workaround leaves duplicate
 * entries the user then has to press Back through twice.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const router = useRouter();
  const [pendingDestination, setPendingDestination] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!when) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [when]);

  React.useEffect(() => {
    if (!when) return;
    function interceptNavigation(event: MouseEvent) {
      const destination = inAppDestination(event);
      if (destination === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingDestination(destination);
    }
    document.addEventListener('click', interceptNavigation, true);
    return () => document.removeEventListener('click', interceptNavigation, true);
  }, [when]);

  return (
    <Dialog.Root
      open={pendingDestination !== null}
      onOpenChange={(open) => { if (!open) setPendingDestination(null); }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Unsaved changes
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            You have unsaved changes. Are you sure you want to leave?
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setPendingDestination(null)}
              className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
            >
              Stay on this page
            </button>
            <button
              onClick={() => {
                if (pendingDestination === null) return;
                const destination = pendingDestination;
                setPendingDestination(null);
                router.push(destination);
              }}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Leave without saving
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
