'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { effectiveModelSettings } from '@mediforce/platform-core';
import { useAuth } from '@/contexts/auth-context';
import { useNamespace } from '@/hooks/use-namespace';
import { useNamespaceMembers } from '@/hooks/use-namespace-members';
import { routes } from '@/lib/routes';
import { OUTPUT_BUDGET_LABELS } from './settings/output-budget-slider';

/** The output budget the caller's calls in `handle` get, read-only, with the way to change it. */
export function OutputBudgetNotice({ handle }: { handle: string }) {
  const { user } = useAuth();
  const { namespace } = useNamespace(handle);
  const { members } = useNamespaceMembers(handle);

  const effective = effectiveModelSettings(namespace, members.find((member) => member.uid === user?.id)).outputBudget;

  return (
    <div className="flex items-center justify-between gap-2 text-xs" data-testid="output-budget-notice">
      <span className="text-muted-foreground">
        Output budget{' '}
        <span className="ml-1 rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">
          {OUTPUT_BUDGET_LABELS[effective]}
        </span>
      </span>
      <Link href={routes.settings(handle)} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
        Change in settings
        <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
