'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { useCommandPalette } from './provider';
import { Kbd } from './kbd';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function CommandPaletteTrigger() {
  const { open } = useCommandPalette();
  const [modKey, setModKey] = React.useState('⌘');

  React.useEffect(() => {
    setModKey(IS_MAC ? '⌘' : 'Ctrl');
  }, []);

  return (
    <button
      onClick={open}
      className="inline-flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Open command palette"
      data-testid="command-palette-trigger"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Search</span>
      <span className="flex items-center gap-1">
        <Kbd>{modKey}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
