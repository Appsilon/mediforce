'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles } from 'lucide-react';
import { DEMO_SCENARIOS } from '@/lib/demo-content';
import { useTour } from './tour-provider';

/** The showcase walkthroughs, offered to anyone inside a workspace. */
export function DemoTrigger() {
  const { startScenario } = useTour();
  const [open, setOpen] = React.useState(false);


  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="inline-flex h-8 items-center gap-2 rounded-md border border-primary bg-muted/40 px-2 text-xs text-primary transition-colors hover:bg-accent"
        aria-label="Play a demo scenario"
        data-testid="demo-trigger"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Demo</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          data-testid="demo-scenarios"
        >
          <div className="border-b px-5 py-3.5">
            <Dialog.Title className="font-headline text-base font-semibold">Demo scenarios</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">
              Each one walks a job across the real app. You do the clicking — it narrates and points.
            </Dialog.Description>
          </div>
          <div className="p-2">
            {DEMO_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                data-testid={`demo-scenario-${scenario.id}`}
                onClick={() => {
                  setOpen(false);
                  startScenario(scenario.id);
                }}
                className="flex w-full items-baseline gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{scenario.title}</span>
                  <span className="block text-xs text-muted-foreground">{scenario.blurb}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {scenario.minutes} min
                </span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
