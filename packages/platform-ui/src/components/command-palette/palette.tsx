'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { usePathname } from 'next/navigation';
import { Search, ArrowLeft, CornerDownLeft } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { useCommandPalette } from './provider';
import { useToast } from './toast-provider';
import { Kbd, KbdRow } from './kbd';
import type { Command, CommandContext } from './types';

const SECTION_LABEL: Record<string, string> = {
  global: 'Global',
  tickets: 'Tickets',
  navigation: 'Navigation',
};

export function CommandPalette() {
  const { state, close, open, openCommand, commands } = useCommandPalette();
  const pathname = usePathname();
  const { firebaseUser } = useAuth();
  const { toast } = useToast();

  const isOpen = state.kind !== 'closed';
  const activeCommand: Command | undefined =
    state.kind === 'command' ? commands.find((command) => command.id === state.commandId) : undefined;

  const ctx = React.useMemo<CommandContext>(
    () => ({
      pathname: pathname ?? '/',
      user: {
        uid: firebaseUser?.uid ?? '',
        displayName: firebaseUser?.displayName ?? null,
        email: firebaseUser?.email ?? null,
      },
      close,
      toast,
      getIdToken: async () => (firebaseUser !== null ? firebaseUser.getIdToken() : null),
    }),
    [pathname, firebaseUser, close, toast],
  );

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 rounded-lg border bg-background shadow-xl focus:outline-none"
          data-testid="command-palette"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">
            {activeCommand !== undefined ? activeCommand.title : 'Command palette'}
          </Dialog.Title>

          {state.kind === 'list' && <CommandList ctx={ctx} onSelect={openCommand} />}
          {state.kind === 'command' && activeCommand !== undefined && (
            <CommandView command={activeCommand} ctx={ctx} onBack={open} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandList({ ctx, onSelect }: { ctx: CommandContext; onSelect: (commandId: string) => void }) {
  const { commands } = useCommandPalette();
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return commands;
    return commands.filter((command) => {
      if (command.title.toLowerCase().includes(q)) return true;
      if (typeof command.description === 'string' && command.description.toLowerCase().includes(q)) return true;
      if (command.keywords !== undefined) {
        for (const keyword of command.keywords) {
          if (keyword.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [commands, query]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runCommand(command: Command) {
    if ('view' in command && command.view !== undefined) {
      onSelect(command.id);
      return;
    }
    if ('run' in command && command.run !== undefined) {
      ctx.close();
      void command.run(ctx);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command !== undefined) runCommand(command);
    }
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const command of filtered) {
      const list = map.get(command.section) ?? [];
      list.push(command);
      map.set(command.section, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command or search…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          data-testid="command-palette-input"
        />
      </div>

      <div className="max-h-80 overflow-y-auto py-1" role="listbox">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No commands match.</div>
        )}

        {grouped.map(([section, sectionCommands]) => {
          const startIndex = filtered.indexOf(sectionCommands[0]);
          return (
            <div key={section} className="py-1">
              <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {SECTION_LABEL[section] ?? section}
              </div>
              {sectionCommands.map((command, offset) => {
                const index = startIndex + offset;
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-left text-sm',
                      activeIndex === index ? 'bg-accent text-accent-foreground' : 'text-foreground',
                    )}
                    data-testid={`command-${command.id}`}
                    role="option"
                    aria-selected={activeIndex === index}
                  >
                    {Icon !== undefined && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="flex-1 truncate">{command.title}</span>
                    {command.shortcut !== undefined && <KbdRow keys={command.shortcut.display} />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> select</span>
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        </div>
        <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
      </div>
    </div>
  );
}

function CommandView({
  command,
  ctx,
  onBack,
}: {
  command: Command;
  ctx: CommandContext;
  onBack: () => void;
}) {
  if (!('view' in command) || command.view === undefined) {
    return null;
  }
  const View = command.view;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button
          onClick={onBack}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Back to command list"
          data-testid="command-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-foreground">{command.title}</span>
      </div>
      <View ctx={ctx} />
    </div>
  );
}
