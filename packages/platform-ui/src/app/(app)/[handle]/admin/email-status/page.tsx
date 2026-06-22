'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Mail, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { mediforce } from '@/lib/mediforce';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import type { GetEmailStatusOutput } from '@mediforce/platform-api/contract';

export default function AdminEmailStatusPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const { canAdmin, loading: roleLoading } = useNamespaceRole(handle);
  const [data, setData] = useState<GetEmailStatusOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading || !canAdmin) return;
    setLoading(true);
    mediforce.system
      .emailStatus()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [canAdmin, roleLoading]);

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-muted-foreground">You need admin access to view this page.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link
        href={`/${handle}/settings`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Settings
      </Link>

      <div className="mb-8">
        <h1 className="text-lg font-semibold">Email provider</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Email is used for user invitations, workflow notifications, and alerts.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error !== null && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {data !== null && !loading && (
        <div className="rounded-lg border bg-card">
          <div className="px-5 py-4 flex items-start gap-4">
            <div className="mt-0.5 rounded-md bg-muted p-2">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                {data.configured ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  {data.provider !== null
                    ? data.provider.charAt(0).toUpperCase() + data.provider.slice(1)
                    : 'Not configured'}
                </span>
              </div>

              {data.configured && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd>{data.provider}</dd>
                  <dt className="text-muted-foreground">From address</dt>
                  <dd className="font-mono text-xs">{data.from ?? '—'}</dd>
                </dl>
              )}

              {!data.configured && (
                <p className="text-xs text-muted-foreground">
                  Set <code className="rounded bg-muted px-1 py-0.5">EMAIL_PROVIDER</code> and the corresponding
                  provider env vars to enable email. See the deployment guide for details.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
