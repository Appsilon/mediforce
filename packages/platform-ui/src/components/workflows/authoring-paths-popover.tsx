'use client';

import * as Popover from '@radix-ui/react-popover';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { HelpCircle, ExternalLink } from 'lucide-react';
import { AUTHORING_PATHS, type AuthoringPath } from '@/lib/authoring-paths';
import { CREATE_WORKFLOW_URL } from '@mediforce/platform-core';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

function PathEntry({ path, handle }: { path: AuthoringPath; handle: string }) {
  const body = (
    <>
      <path.icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{path.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{path.reason}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{path.how}</p>
      </div>
    </>
  );

  return (
    <li data-testid={`authoring-path-${path.id}`}>
      {path.id === 'import' ? (
        // The one path that is a click rather than an instruction. The importer
        // lives on the workspace home, which this popover is not always on.
        <Link
          href={routes.importWorkflows(handle)}
          className="flex gap-2.5 rounded-md p-1.5 -m-1.5 hover:bg-muted transition-colors"
        >
          {body}
        </Link>
      ) : (
        <div className="flex gap-2.5">{body}</div>
      )}
    </li>
  );
}

/** Names every way to author a workflow and states a reason to pick each one.
 *  The reasons are carried inline rather than linked: docs/ is only reachable
 *  with a git checkout, which the reader may not have (#1185). */
export function AuthoringPathsPopover() {
  const { handle } = useParams<{ handle: string }>();

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap shrink-0',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Ways to author
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-96 rounded-lg border bg-popover p-3 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Ways to author a workflow
          </span>
          <ul className="mt-2 space-y-3">
            {AUTHORING_PATHS.map((path) => (
              <PathEntry key={path.id} path={path} handle={handle} />
            ))}
          </ul>
          <a
            href={CREATE_WORKFLOW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-1 border-t pt-2 text-xs text-primary hover:underline"
          >
            Full guide: create-workflow.md
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
