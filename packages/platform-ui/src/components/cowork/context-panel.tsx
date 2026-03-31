'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';
import type { CoworkSession, ProcessInstance } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Context panel (foldable)
// ---------------------------------------------------------------------------

interface ContextPanelProps {
  session: CoworkSession;
  instance: ProcessInstance | null;
  handle: string;
}

export function ContextPanel({
  instance,
  session,
  handle,
}: ContextPanelProps) {
  const [open, setOpen] = React.useState(true);

  const previousStepOutput = React.useMemo(() => {
    if (!instance) return null;
    const vars = instance.variables as Record<string, unknown>;
    const keys = Object.keys(vars);
    if (keys.length === 0) return null;
    return vars;
  }, [instance]);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors rounded-t-lg border border-b-0 rounded-b-none bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Session Context
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="border border-t-0 rounded-b-lg px-4 py-3 space-y-3 text-sm bg-muted/10">
          {/* Metadata grid */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Run</div>
              {instance ? (
                <Link
                  href={routes.workflowRun(handle, instance.definitionName, instance.id)}
                  className="text-primary hover:underline font-mono text-xs"
                >
                  {instance.id.slice(0, 8)}...
                </Link>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">{session.processInstanceId.slice(0, 8)}...</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Step</div>
              <span className="text-xs">{session.stepId}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Role</div>
              <span className="text-xs">{session.assignedRole}</span>
            </div>
          </div>

          {/* Previous step output */}
          {previousStepOutput && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Previous step output</div>
              <pre className="rounded-md bg-muted p-2 text-xs overflow-auto max-h-32 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(previousStepOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
