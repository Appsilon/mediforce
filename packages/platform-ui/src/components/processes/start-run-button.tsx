'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Play, ChevronDown, Loader2, Check } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useAuth } from '@/contexts/auth-context';
import { startWorkflowRun } from '@/app/actions/processes';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';

interface StartRunButtonProps {
  workflowName: string;
  /** If provided, starts this specific version. Otherwise uses default/latest. */
  version?: number;
  /** Show version dropdown (split button). */
  showVersionPicker?: boolean;
}

export function StartRunButton({ workflowName, version, showVersionPicker }: StartRunButtonProps) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { definitions, effectiveVersion: hookEffectiveVersion } = useWorkflowDefinitions(workflowName);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const effectiveVersion = version ?? hookEffectiveVersion;

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
    setError(null);
    setDropdownOpen(false);

    const result = await startWorkflowRun({
      definitionName: workflowName,
      definitionVersion: targetVersion,
      triggeredBy: firebaseUser.uid,
    });

    if (result.success && result.instanceId) {
      router.push(`/workflows/${encodeURIComponent(workflowName)}/runs/${result.instanceId}`);
    } else {
      console.error('[StartRunButton] Failed to start run:', result.error);
      setError(result.error ?? 'Failed to start run');
      setStarting(false);
    }
  }

  if (effectiveVersion === 0) return null;

  const errorBanner = error ? (
    <p className="mt-1 text-xs text-destructive max-w-xs truncate" title={error}>{error}</p>
  ) : null;

  // Simple button — no version picker
  if (!showVersionPicker || definitions.length <= 1) {
    return (
      <div>
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
        {errorBanner}
      </div>
    );
  }

  // Split button — main action + version dropdown
  return (
    <div>
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
          <div className="absolute right-0 top-full mt-1 z-10 min-w-[200px] rounded-md border bg-popover shadow-md">
            {definitions.filter((def) => def.archived !== true).map((def) => {
              const isEffective = def.version === effectiveVersion;

              return (
                <button
                  key={def.version}
                  onClick={() => handleStart(def.version)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors first:rounded-t-md last:rounded-b-md',
                    isEffective && 'bg-muted/30 font-medium',
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5 shrink-0', isEffective ? 'text-primary' : 'invisible')} />
                  <VersionLabel version={def.version} title={def.title} variant="inline" />
                  {isEffective && (
                    <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400 ml-auto shrink-0">
                      default
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {errorBanner}
    </div>
  );
}
