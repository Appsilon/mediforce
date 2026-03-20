'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Play, ChevronDown, Loader2 } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useAuth } from '@/contexts/auth-context';
import { startWorkflowRun } from '@/app/actions/processes';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';

interface StartRunButtonProps {
  workflowName: string;
  /** If provided, starts this specific version. Otherwise uses latest. */
  version?: number;
  /** Show version dropdown (split button). Only on workflow overview page. */
  showVersionPicker?: boolean;
}

export function StartRunButton({ workflowName, version, showVersionPicker }: StartRunButtonProps) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { definitions, latestVersion } = useWorkflowDefinitions(workflowName);
  const [starting, setStarting] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const effectiveVersion = version ?? latestVersion;

  React.useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  async function handleStart(v?: number) {
    const targetVersion = v ?? effectiveVersion;
    if (!firebaseUser || targetVersion === 0) return;

    setStarting(true);
    setDropdownOpen(false);

    const result = await startWorkflowRun({
      definitionName: workflowName,
      definitionVersion: targetVersion,
      triggeredBy: firebaseUser.uid,
    });

    if (result.success && result.instanceId) {
      router.push(`/workflows/${encodeURIComponent(workflowName)}/runs/${result.instanceId}`);
    } else {
      setStarting(false);
    }
  }

  if (effectiveVersion === 0) return null;

  // Simple button — no version picker
  if (!showVersionPicker || definitions.length <= 1) {
    return (
      <button
        disabled={starting}
        onClick={() => handleStart()}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
          starting && 'opacity-50 cursor-not-allowed',
        )}
      >
        {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {starting ? 'Starting...' : 'Start Run'}
      </button>
    );
  }

  // Split button — main action + version dropdown
  return (
    <div className="relative inline-flex" ref={dropdownRef}>
      <button
        disabled={starting}
        onClick={() => handleStart()}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-l-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
          starting && 'opacity-50 cursor-not-allowed',
        )}
      >
        {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {starting ? 'Starting...' : 'Start Run'}
      </button>
      <button
        onClick={() => setDropdownOpen((prev) => !prev)}
        className="inline-flex items-center rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 py-1.5 text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', dropdownOpen && 'rotate-180')} />
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 top-full mt-1 z-10 min-w-[160px] rounded-md border bg-popover shadow-md">
          {definitions.map((def) => (
            <button
              key={def.version}
              onClick={() => handleStart(def.version)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors first:rounded-t-md last:rounded-b-md',
                def.version === latestVersion && 'font-medium',
              )}
            >
              <VersionLabel version={def.version} title={def.title} variant="inline" />
              {def.version === latestVersion && (
                <span className="text-xs text-muted-foreground ml-auto shrink-0">latest</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
