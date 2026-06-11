import { CheckCircle, XCircle, MessageSquare, Circle } from 'lucide-react';

export type Intent = 'success' | 'warning' | 'danger' | 'neutral';

type IntentStyles = {
  Icon: typeof CheckCircle;
  submit: string;
  card: string;
  iconColor: string;
  text: string;
  blockquote: string;
  timestamp: string;
};

export const INTENT_STYLES: Record<Intent, IntentStyles> = {
  success: {
    Icon: CheckCircle,
    submit: 'bg-green-600 text-white hover:bg-green-700',
    card: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
    iconColor: 'text-green-600 dark:text-green-400',
    text: 'text-green-800 dark:text-green-300',
    blockquote: 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300',
    timestamp: 'text-green-600/70 dark:text-green-400/70',
  },
  warning: {
    Icon: MessageSquare,
    submit: 'bg-blue-900 text-white hover:bg-blue-800 dark:bg-blue-800 dark:hover:bg-blue-700',
    card: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
    iconColor: 'text-amber-600 dark:text-amber-400',
    text: 'text-amber-800 dark:text-amber-300',
    blockquote: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
    timestamp: 'text-amber-600/70 dark:text-amber-400/70',
  },
  danger: {
    Icon: XCircle,
    submit: 'bg-blue-900 text-white hover:bg-blue-800 dark:bg-blue-800 dark:hover:bg-blue-700',
    card: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
    text: 'text-red-800 dark:text-red-300',
    blockquote: 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300',
    timestamp: 'text-red-600/70 dark:text-red-400/70',
  },
  neutral: {
    Icon: Circle,
    submit: 'bg-blue-900 text-white hover:bg-blue-800 dark:bg-blue-800 dark:hover:bg-blue-700',
    card: 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-800',
    iconColor: 'text-slate-600 dark:text-slate-400',
    text: 'text-slate-800 dark:text-slate-300',
    blockquote: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
    timestamp: 'text-slate-600/70 dark:text-slate-400/70',
  },
};
