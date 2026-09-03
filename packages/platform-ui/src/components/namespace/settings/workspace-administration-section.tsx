import { Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { routes } from '@/lib/routes';

export function WorkspaceAdministrationSection({ handle }: { handle: string }) {
  const entries = [
    {
      href: routes.adminInfrastructure(handle),
      title: 'Infrastructure',
      description: 'Docker images and disk usage',
    },
    {
      href: routes.adminToolCatalog(handle, { from: 'settings' }),
      title: 'Tool catalog',
      description: 'MCP servers available to agents',
    },
    {
      href: routes.adminOAuthProviders(handle, { from: 'settings' }),
      title: 'OAuth providers',
      description: 'External authentication for MCP tools',
    },
    {
      href: `/${handle}/admin/email-status`,
      title: 'Email',
      description: 'Email provider configuration status',
    },
  ];

  return (
    <div className="mb-10 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Administration</h2>
      <div className="rounded-lg border bg-card px-4 py-5 space-y-3">
        {entries.map((entry, index) => (
          <Fragment key={entry.href}>
            {index > 0 && <div className="border-t" />}
            <Link href={entry.href} className="flex items-center justify-between group">
              <div>
                <p className="text-sm font-medium group-hover:text-primary transition-colors">{entry.title}</p>
                <p className="text-xs text-muted-foreground">{entry.description}</p>
              </div>
              <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 group-hover:text-primary transition-colors" />
            </Link>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
