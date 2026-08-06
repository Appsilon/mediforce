'use client';

import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import type { ReactElement } from 'react';

export function WorkspaceAccessError({ handle }: { handle: string }): ReactElement {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-center"
      data-testid="workspace-access-error"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden="true" />
      </div>
      <div className="max-w-lg space-y-2">
        <h1 className="text-2xl font-semibold">Workspace unavailable</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t open <span className="font-mono">@{handle}</span>. You may not have access to this
          workspace, or it may no longer exist. Ask a workspace admin to invite you if you need access.
        </p>
      </div>
      <Link
        href="/workspace-selection"
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Choose another workspace
      </Link>
    </main>
  );
}
