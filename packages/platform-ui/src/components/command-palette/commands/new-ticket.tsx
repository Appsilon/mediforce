'use client';

import * as React from 'react';
import { Loader2, Bug, Lightbulb, HelpCircle, MapPin, User as UserIcon, X as XIcon } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import type { CommandViewProps } from '../types';

type TicketType = 'bug' | 'idea' | 'question';

type TicketTypeConfig = {
  value: TicketType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  template: string;
  color: string;
};

const TICKET_TYPES: readonly TicketTypeConfig[] = [
  {
    value: 'bug',
    label: 'Bug',
    icon: Bug,
    color: 'text-red-600 dark:text-red-400',
    template: '**Steps to reproduce:**\n1. \n2. \n\n**Expected:**\n\n**Actual:**',
  },
  {
    value: 'idea',
    label: 'Idea',
    icon: Lightbulb,
    color: 'text-amber-600 dark:text-amber-400',
    template: '**Problem:**\n\n**Proposed solution:**',
  },
  {
    value: 'question',
    label: 'Question',
    icon: HelpCircle,
    color: 'text-blue-600 dark:text-blue-400',
    template: '**Question:**',
  },
];

type ContextChip = {
  id: string;
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  removable: boolean;
};

export function NewTicketView({ ctx }: CommandViewProps) {
  const [type, setType] = React.useState<TicketType>('bug');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState(TICKET_TYPES[0].template);
  const [touchedDescription, setTouchedDescription] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);

  const filedByLabel = ctx.user.displayName ?? ctx.user.email ?? 'Unknown user';

  const [chips, setChips] = React.useState<ContextChip[]>(() => [
    {
      id: 'filed-by',
      label: 'Filed by',
      value: filedByLabel,
      icon: UserIcon,
      removable: false,
    },
    {
      id: 'url',
      label: 'Page',
      value: ctx.pathname,
      icon: MapPin,
      removable: true,
    },
  ]);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function handleTypeChange(nextType: TicketType) {
    setType(nextType);
    if (!touchedDescription) {
      const config = TICKET_TYPES.find((entry) => entry.value === nextType);
      if (config !== undefined) setDescription(config.template);
    }
  }

  function handleDescriptionChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setDescription(event.target.value);
    setTouchedDescription(true);
  }

  function removeChip(id: string) {
    setChips((prev) => prev.filter((chip) => chip.id !== id));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      setError('Title is required.');
      return;
    }

    setSubmitting(true);
    try {
      const token = await ctx.getIdToken();
      if (token === null) {
        setError('You must be signed in to file a ticket.');
        setSubmitting(false);
        return;
      }

      const response = await apiFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          description,
          type,
          context: chips.map((chip) => ({ label: chip.label, value: chip.value })),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message =
          typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `Failed to create ticket (${response.status})`;
        setError(message);
        setSubmitting(false);
        return;
      }

      const data = (await response.json()) as { number: number; url: string };
      ctx.toast({
        title: `Ticket #${data.number} created`,
        description: trimmedTitle,
        variant: 'success',
        action: { label: 'View on GitHub', href: data.url },
      });
      ctx.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4" data-testid="new-ticket-form">
      <div className="flex flex-wrap gap-1.5">
        {TICKET_TYPES.map((config) => {
          const Icon = config.icon;
          const active = type === config.value;
          return (
            <button
              key={config.value}
              type="button"
              onClick={() => handleTypeChange(config.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              data-testid={`ticket-type-${config.value}`}
              aria-pressed={active}
            >
              <Icon className={cn('h-3.5 w-3.5', active ? config.color : '')} />
              {config.label}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="ticket-title" className="sr-only">Title</label>
        <input
          id="ticket-title"
          ref={titleRef}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Short summary…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          disabled={submitting}
          data-testid="ticket-title-input"
          autoComplete="off"
          required
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="ticket-chips">
          {chips.map((chip) => {
            const ChipIcon = chip.icon;
            return (
              <span
                key={chip.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground"
                data-testid={`ticket-chip-${chip.id}`}
              >
                <ChipIcon className="h-3 w-3" />
                <span className="font-medium text-foreground">{chip.label}:</span>
                <span className="max-w-[200px] truncate">{chip.value}</span>
                {chip.removable && (
                  <button
                    type="button"
                    onClick={() => removeChip(chip.id)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-background"
                    aria-label={`Remove ${chip.label} context`}
                    data-testid={`ticket-chip-remove-${chip.id}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div>
        <label htmlFor="ticket-description" className="sr-only">Description</label>
        <textarea
          id="ticket-description"
          value={description}
          onChange={handleDescriptionChange}
          placeholder="What's going on? Markdown is supported."
          className="w-full min-h-[140px] resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          disabled={submitting}
          data-testid="ticket-description-input"
        />
      </div>

      {error !== null && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="ticket-error">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          Posts to <span className="font-mono">appsilon/mediforce</span> as a GitHub issue.
        </span>
        <button
          type="submit"
          disabled={submitting || title.trim() === ''}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            submitting || title.trim() === ''
              ? 'bg-primary/40 text-primary-foreground/70 cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
          data-testid="ticket-submit"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? 'Creating…' : 'Create ticket'}
        </button>
      </div>
    </form>
  );
}
