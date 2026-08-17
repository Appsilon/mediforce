'use client';

import { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { WORKSPACE_DEFAULT_KEY } from '@/lib/workspace-icons';

export function DefaultWorkspaceSection({ handle }: { handle: string }) {
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    setIsDefault(localStorage.getItem(WORKSPACE_DEFAULT_KEY) === handle);
  }, [handle]);

  function handleToggle(checked: boolean) {
    if (checked) {
      localStorage.setItem(WORKSPACE_DEFAULT_KEY, handle);
    } else {
      localStorage.removeItem(WORKSPACE_DEFAULT_KEY);
    }
    setIsDefault(checked);
  }

  return (
    <div className="mb-10 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preferences</h2>
      <div className="rounded-lg border bg-card px-4 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Default workspace</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Open this workspace automatically when you sign in.
            </p>
          </div>
          <Switch.Root
            checked={isDefault}
            onCheckedChange={handleToggle}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:bg-primary"
            aria-label="Set as default workspace"
          >
            <Switch.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
          </Switch.Root>
        </div>
      </div>
    </div>
  );
}
