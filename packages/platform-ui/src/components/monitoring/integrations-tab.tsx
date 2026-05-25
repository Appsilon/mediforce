'use client';

import { formatDistanceToNow } from 'date-fns';
import { CheckCircle, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

type ServiceStatus = 'healthy' | 'degraded' | 'down';

interface ServiceEntry {
  id: string;
  name: string;
  category: string;
  status: ServiceStatus;
  lastUsed: Date;
  keyMetric: string;
  usedIn: string[];
  lastError: string | null;
  lastErrorTime: Date | null;
}

const SERVICES: ServiceEntry[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'AI routing',
    status: 'healthy',
    lastUsed: new Date(Date.now() - 5 * 60 * 1000),
    keyMetric: '$0.42 spent today · $48.23 remaining',
    usedIn: ['pr-reviewer', 'risk-assessor', 'supply-chain-agent'],
    lastError: null,
    lastErrorTime: null,
  },
  {
    id: 'github-mcp',
    name: 'GitHub (MCP)',
    category: 'Version control',
    status: 'healthy',
    lastUsed: new Date(Date.now() - 2 * 60 * 60 * 1000),
    keyMetric: '14 tool calls today',
    usedIn: ['pr-reviewer'],
    lastError: null,
    lastErrorTime: null,
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    category: 'Email delivery',
    status: 'healthy',
    lastUsed: new Date(Date.now() - 6 * 60 * 60 * 1000),
    keyMetric: '12 emails sent this week',
    usedIn: ['notification workflows'],
    lastError: null,
    lastErrorTime: null,
  },
  {
    id: 'firestore',
    name: 'Firestore',
    category: 'Database',
    status: 'healthy',
    lastUsed: new Date(Date.now() - 30 * 1000),
    keyMetric: 'Read latency avg 18ms',
    usedIn: ['all workflows'],
    lastError: null,
    lastErrorTime: null,
  },
  {
    id: 'firebase-auth',
    name: 'Firebase Auth',
    category: 'Authentication',
    status: 'healthy',
    lastUsed: new Date(Date.now() - 12 * 60 * 1000),
    keyMetric: '3 active sessions',
    usedIn: ['platform-ui'],
    lastError: null,
    lastErrorTime: null,
  },
];

const STATUS_ICON: Record<ServiceStatus, { Icon: typeof CheckCircle; className: string }> = {
  healthy: { Icon: CheckCircle, className: 'text-green-500' },
  degraded: { Icon: AlertTriangle, className: 'text-amber-500' },
  down: { Icon: XCircle, className: 'text-red-500' },
};

const STATUS_BADGE: Record<ServiceStatus, string> = {
  healthy: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  degraded: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  down: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const recentErrors = SERVICES.filter((s) => s.lastError !== null);

export function IntegrationsTab() {
  const healthy = SERVICES.filter((s) => s.status === 'healthy').length;
  const degraded = SERVICES.filter((s) => s.status === 'degraded').length;
  const down = SERVICES.filter((s) => s.status === 'down').length;

  return (
    <div className="space-y-8">
      <div className="rounded-md border bg-card px-4 py-2 text-xs text-muted-foreground">
        Integration health is mocked — live status checks will be added once health-probe endpoints are wired up.
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 max-w-sm">
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <div className="text-3xl font-bold font-headline text-green-600 dark:text-green-400">{healthy}</div>
          <div className="text-sm text-muted-foreground">Healthy</div>
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <div className={cn('text-3xl font-bold font-headline', degraded > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{degraded}</div>
          <div className="text-sm text-muted-foreground">Degraded</div>
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <div className={cn('text-3xl font-bold font-headline', down > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{down}</div>
          <div className="text-sm text-muted-foreground">Down</div>
        </div>
      </div>

      {/* Service list */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Services
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((svc) => {
            const { Icon, className: iconClass } = STATUS_ICON[svc.status];
            return (
              <div
                key={svc.id}
                className="rounded-lg border bg-card p-4 space-y-3 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm">{svc.name}</div>
                    <div className="text-xs text-muted-foreground">{svc.category}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Icon className={cn('h-4 w-4', iconClass)} />
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_BADGE[svc.status])}>
                      {svc.status}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">{svc.keyMetric}</div>

                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="font-medium">Last used:</span>
                    {formatDistanceToNow(svc.lastUsed, { addSuffix: true })}
                  </div>
                  <div className="flex items-start gap-1.5 text-muted-foreground">
                    <span className="font-medium shrink-0">Used in:</span>
                    <span>{svc.usedIn.join(', ')}</span>
                  </div>
                </div>

                {svc.lastError !== null && svc.lastErrorTime !== null && (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="font-medium text-red-600 dark:text-red-400">Last error</span>
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(svc.lastErrorTime, { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-red-600 dark:text-red-400">{svc.lastError}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Error log */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent integration errors
        </h2>
        {recentErrors.length === 0 ? (
          <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
            No integration errors in the past 24 hours.
          </div>
        ) : (
          <div className="space-y-2">
            {recentErrors.map((svc) => (
              <div
                key={svc.id}
                className="rounded-md border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{svc.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {svc.lastErrorTime !== null
                      ? formatDistanceToNow(svc.lastErrorTime, { addSuffix: true })
                      : ''}
                  </span>
                </div>
                <p className="text-xs text-red-600 dark:text-red-400">{svc.lastError}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Used in: {svc.usedIn.join(', ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
