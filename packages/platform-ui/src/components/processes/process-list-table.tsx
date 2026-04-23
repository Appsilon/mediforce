'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import type { ProcessInstance } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function ProcessListTable({
  instances,
  loading,
}: {
  instances: ProcessInstance[];
  loading: boolean;
}) {
  const handle = useHandleFromPath();
  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Workflow', 'Version', 'Status', 'Current Step', 'Started', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : instances.length === 0
            ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No workflows found
                </td>
              </tr>
            )
            : instances.map((inst) => (
              <tr key={inst.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{inst.definitionName}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{inst.definitionVersion}</td>
                <td className="px-4 py-3"><ProcessStatusBadge status={inst.status} pauseReason={inst.pauseReason} /></td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{inst.currentStepId ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {format(new Date(inst.createdAt), 'MMM d, HH:mm')}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/${handle}/workflows/${inst.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Detail <ExternalLink className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
