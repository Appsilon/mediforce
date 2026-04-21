import type * as React from 'react';

export type CommandSection = 'global' | 'tickets' | 'navigation';

export type CommandIcon = React.ComponentType<{ className?: string }>;

export type Shortcut = {
  /** Rendered representation, e.g. "⌘ K", "?". */
  display: string[];
  /** Matches a browser KeyboardEvent. */
  matches: (event: KeyboardEvent) => boolean;
  /** Label shown in the shortcuts overlay. */
  label: string;
  section: CommandSection;
};

export type CommandContext = {
  pathname: string;
  user: { uid: string; displayName: string | null; email: string | null };
  close: () => void;
  toast: (opts: ToastOpts) => void;
  /** Returns a fresh Firebase ID token for server-authenticated calls. */
  getIdToken: () => Promise<string | null>;
};

export type CommandViewProps = {
  ctx: CommandContext;
};

type CommandBase = {
  id: string;
  title: string;
  description?: string;
  section: CommandSection;
  keywords?: string[];
  icon?: CommandIcon;
  /** Optional shortcut — bound globally and shown in the shortcuts overlay. */
  shortcut?: Omit<Shortcut, 'label' | 'section'>;
};

export type ActionCommand = CommandBase & {
  run: (ctx: CommandContext) => void | Promise<void>;
  view?: never;
};

export type ViewCommand = CommandBase & {
  view: React.ComponentType<CommandViewProps>;
  run?: never;
};

export type Command = ActionCommand | ViewCommand;

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastOpts = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: { label: string; href: string };
};
