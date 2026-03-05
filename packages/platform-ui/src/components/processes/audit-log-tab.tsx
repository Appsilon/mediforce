'use client';

import * as React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { format } from 'date-fns';
import { ChevronDown, User, Bot, Settings } from 'lucide-react';
import type { AuditEvent } from '@mediforce/platform-core';

type AuditEventWithId = AuditEvent & { id: string };

const ACTOR_ICON: Record<string, React.ReactNode> = {
  user: <User className="h-3 w-3" />,
  agent: <Bot className="h-3 w-3" />,
  system: <Settings className="h-3 w-3" />,
};

function CollapsiblePayload({ label, data }: { label: string; data: Record<string, unknown> }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-180" />
        {label}
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-1">
        <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-48">
          {JSON.stringify(data, null, 2)}
        </pre>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function AuditLogTab({ events, loading, error }: { events: AuditEventWithId[]; loading: boolean; error?: Error | null }) {
  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load audit events: {error.message}
      </div>
    );
  }

  if (events.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No audit events</div>;
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-md border p-3 space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <div className="font-medium">{event.action}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  {ACTOR_ICON[event.actorType] ?? ACTOR_ICON.system}
                  {event.actorId}
                </span>
                {event.stepId && (
                  <span className="font-mono">· {event.stepId}</span>
                )}
              </div>
              {event.description && (
                <div className="text-xs text-muted-foreground">{event.description}</div>
              )}
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              {format(new Date(event.timestamp), 'MMM d, HH:mm:ss')}
            </div>
          </div>

          {/* Collapsible payloads */}
          <div className="space-y-1.5 pl-1">
            {Object.keys(event.inputSnapshot).length > 0 && (
              <CollapsiblePayload label="Input snapshot" data={event.inputSnapshot} />
            )}
            {Object.keys(event.outputSnapshot).length > 0 && (
              <CollapsiblePayload label="Output snapshot" data={event.outputSnapshot} />
            )}
            {event.basis && (
              <div className="text-xs text-muted-foreground">Basis: {event.basis}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
