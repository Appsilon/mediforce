import { Keyboard, TicketPlus } from 'lucide-react';
import type { Command } from '../types';
import { NewTicketView } from './new-ticket';
import { KeyboardShortcutsView } from './keyboard-shortcuts';

export const COMMANDS: readonly Command[] = [
  {
    id: 'new-ticket',
    title: 'New ticket',
    description: 'File a bug, idea, or question to the Mediforce repo.',
    section: 'tickets',
    keywords: ['bug', 'idea', 'feedback', 'issue', 'report', 'feature'],
    icon: TicketPlus,
    view: NewTicketView,
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Show all available keyboard shortcuts.',
    section: 'global',
    keywords: ['help', 'shortcuts', 'keys'],
    icon: Keyboard,
    shortcut: {
      display: ['?'],
      matches: (event) => event.key === '?' && !event.metaKey && !event.ctrlKey,
    },
    view: KeyboardShortcutsView,
  },
];
