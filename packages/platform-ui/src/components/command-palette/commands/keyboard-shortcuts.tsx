'use client';

import * as React from 'react';
import { useCommandPalette } from '../provider';
import { KbdRow } from '../kbd';
import type { CommandViewProps, Shortcut } from '../types';

const SECTION_LABEL: Record<string, string> = {
  global: 'Global',
  tickets: 'Tickets',
  navigation: 'Navigation',
};

export function KeyboardShortcutsView(_props: CommandViewProps) {
  const { commands, globalShortcuts } = useCommandPalette();

  const allShortcuts: Shortcut[] = React.useMemo(() => {
    const commandShortcuts: Shortcut[] = [];
    for (const command of commands) {
      if (command.shortcut !== undefined) {
        commandShortcuts.push({
          display: command.shortcut.display,
          matches: command.shortcut.matches,
          label: command.title,
          section: command.section,
        });
      }
    }
    return [...globalShortcuts, ...commandShortcuts];
  }, [commands, globalShortcuts]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, Shortcut[]>();
    for (const shortcut of allShortcuts) {
      const list = map.get(shortcut.section) ?? [];
      list.push(shortcut);
      map.set(shortcut.section, list);
    }
    return Array.from(map.entries());
  }, [allShortcuts]);

  return (
    <div className="flex flex-col p-4 gap-4" data-testid="shortcuts-view">
      {grouped.map(([section, entries]) => (
        <div key={section}>
          <div className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {SECTION_LABEL[section] ?? section}
          </div>
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <li
                key={`${entry.section}-${entry.label}`}
                className="flex items-center justify-between py-1.5 text-sm"
              >
                <span className="text-foreground">{entry.label}</span>
                <KbdRow keys={entry.display} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Tip: press <KbdInline>⌘</KbdInline> <KbdInline>K</KbdInline> anywhere in the app to open the command palette.
      </p>
    </div>
  );
}

function KbdInline({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
