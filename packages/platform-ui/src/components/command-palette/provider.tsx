'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { ToastProvider, useToast } from './toast-provider';
import { CommandPalette } from './palette';
import { COMMANDS } from './commands';
import type { Command, CommandContext, Shortcut } from './types';

type PaletteState =
  | { kind: 'closed' }
  | { kind: 'list' }
  | { kind: 'command'; commandId: string };

type CommandPaletteContextValue = {
  open: () => void;
  close: () => void;
  openCommand: (commandId: string) => void;
  state: PaletteState;
  commands: readonly Command[];
  globalShortcuts: readonly Shortcut[];
};

const Ctx = React.createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = React.useContext(Ctx);
  if (ctx === null) {
    throw new Error('useCommandPalette must be used within <CommandPaletteProvider>');
  }
  return ctx;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('.cm-editor, .monaco-editor') !== null) return true;
  return false;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <CommandPaletteProviderInner>{children}</CommandPaletteProviderInner>
    </ToastProvider>
  );
}

function CommandPaletteProviderInner({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PaletteState>({ kind: 'closed' });
  const pathname = usePathname();
  const { firebaseUser } = useAuth();
  const { toast } = useToast();

  const open = React.useCallback(() => setState({ kind: 'list' }), []);
  const close = React.useCallback(() => setState({ kind: 'closed' }), []);
  const openCommand = React.useCallback((commandId: string) => {
    setState({ kind: 'command', commandId });
  }, []);

  const globalShortcuts = React.useMemo<readonly Shortcut[]>(
    () => [
      {
        display: ['⌘', 'K'],
        matches: (event) =>
          (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k',
        label: 'Open command palette',
        section: 'global',
      },
      {
        display: ['?'],
        matches: (event) => event.key === '?' && !event.metaKey && !event.ctrlKey,
        label: 'Show keyboard shortcuts',
        section: 'global',
      },
      {
        display: ['Esc'],
        // Handled by Radix Dialog itself; listed here purely for the shortcuts overlay.
        matches: () => false,
        label: 'Close palette / overlay',
        section: 'global',
      },
    ],
    [],
  );

  React.useEffect(() => {
    function handler(event: KeyboardEvent): void {
      // ⌘K / Ctrl+K works even inside editable fields — standard palette convention.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setState((prev) => (prev.kind === 'closed' ? { kind: 'list' } : { kind: 'closed' }));
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (event.key === '?' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setState({ kind: 'command', commandId: 'keyboard-shortcuts' });
        return;
      }

      for (const command of COMMANDS) {
        if (command.shortcut !== undefined && command.shortcut.matches(event)) {
          event.preventDefault();
          if ('view' in command && command.view !== undefined) {
            setState({ kind: 'command', commandId: command.id });
          } else if ('run' in command && command.run !== undefined) {
            setState({ kind: 'closed' });
            const ctx = buildCtx();
            void command.run(ctx);
          }
          return;
        }
      }
    }

    function buildCtx(): CommandContext {
      return {
        pathname: pathname ?? '/',
        user: {
          uid: firebaseUser?.uid ?? '',
          displayName: firebaseUser?.displayName ?? null,
          email: firebaseUser?.email ?? null,
        },
        close,
        toast,
        getIdToken: async () => (firebaseUser !== null ? firebaseUser.getIdToken() : null),
      };
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close, firebaseUser, pathname, toast]);

  const ctxValue = React.useMemo<CommandPaletteContextValue>(
    () => ({ open, close, openCommand, state, commands: COMMANDS, globalShortcuts }),
    [open, close, openCommand, state, globalShortcuts],
  );

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      <CommandPalette />
    </Ctx.Provider>
  );
}

export { isEditableTarget };
