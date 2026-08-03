'use client';

import { formatDistanceToNow } from 'date-fns';
import { useOpenRouterCredits } from '@/hooks/use-openrouter-credits';
import { cn } from '@/lib/utils';

interface ServiceEntry {
  id: string;
  name: string;
  category: string;
  lastUsed: Date;
  keyMetric: string;
  usedIn: string[];
}

// Mocked "last used" timestamps — illustrative only, see the banner below.
const SERVICES: ServiceEntry[] = [
  {
    id: 'databricks',
    name: 'Databricks',
    category: 'Compute / Jobs',
    lastUsed: new Date(Date.now() - 45 * 60 * 1000),
    keyMetric: '3 jobs launched today · avg runtime 6m',
    usedIn: ['databricks-job agent-runtime plugin'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'AI routing',
    lastUsed: new Date(Date.now() - 5 * 60 * 1000),
    keyMetric: '', // overridden with live data — see formatOpenRouterMetric
    usedIn: ['agent runs', 'cowork chat', 'nightly model-catalog sync'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'AI routing',
    lastUsed: new Date(Date.now() - 90 * 60 * 1000),
    keyMetric: 'Configured as an alternate opencode-agent model provider',
    usedIn: ['opencode-agent plugin (deepseek/* models)'],
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Version control',
    lastUsed: new Date(Date.now() - 2 * 60 * 60 * 1000),
    keyMetric: '14 tool calls today',
    usedIn: ['MCP tool calls', 'workflow definition import', 'bug/idea ticket filing', 'agent workspace git ops (SSH)'],
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    category: 'Email delivery',
    lastUsed: new Date(Date.now() - 6 * 60 * 60 * 1000),
    keyMetric: '12 emails sent this week',
    usedIn: ['workspace invites', 'notification workflows'],
  },
  {
    id: 'smtp',
    name: 'SMTP',
    category: 'Email delivery (alternate)',
    lastUsed: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    keyMetric: 'Not active — Mailgun is the configured provider',
    usedIn: ['workspace invites', 'notification workflows'],
  },
  {
    id: 'openai-realtime',
    name: 'OpenAI (Realtime API)',
    category: 'Voice AI',
    lastUsed: new Date(Date.now() - 26 * 60 * 60 * 1000),
    keyMetric: '4 voice sessions this week',
    usedIn: ['voice cowork sessions'],
  },
  {
    id: 'google-oauth',
    name: 'Google OAuth',
    category: 'Authentication',
    lastUsed: new Date(Date.now() - 8 * 60 * 1000),
    keyMetric: '9 sign-ins today',
    usedIn: ['sign-in'],
  },
  {
    id: 'oidc-sso',
    name: 'OIDC SSO',
    category: 'Authentication (customer SSO)',
    lastUsed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    keyMetric: 'Not configured for this deployment',
    usedIn: ['sign-in (per-deployment opt-in)'],
  },
  {
    id: 'alert-webhook',
    name: 'Alert Webhook (Slack / Discord)',
    category: 'Alerting',
    lastUsed: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    keyMetric: 'Last fired: model-registry sync failure',
    usedIn: ['model-registry sync failure alerts'],
  },
  {
    id: 'otlp',
    name: 'OpenTelemetry (OTLP export)',
    category: 'Observability',
    lastUsed: new Date(Date.now() - 60 * 1000),
    keyMetric: 'Exporting traces',
    usedIn: ['platform-ui request tracing'],
  },
];

function formatOpenRouterMetric(credits: ReturnType<typeof useOpenRouterCredits>): string {
  if (credits.isLoading) return 'Loading balance…';
  if (!credits.available) return credits.error ?? 'Not configured for this workspace';
  return `$${credits.usage.toFixed(2)} used · $${credits.effectiveRemaining.toFixed(2)} remaining`;
}

export function IntegrationsTab() {
  const credits = useOpenRouterCredits();

  return (
    <div className="space-y-8">
      <div className="rounded-md border bg-card px-4 py-2 text-xs text-muted-foreground">
        Most integration details below (last used, usage counts) are illustrative placeholders — live
        status checks will be added once health-probe endpoints are wired up. OpenRouter's balance is
        real, pulled live from this workspace's configured key.
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((svc) => {
          const isOpenRouter = svc.id === 'openrouter';
          const keyMetric = isOpenRouter ? formatOpenRouterMetric(credits) : svc.keyMetric;
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
                {isOpenRouter && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300 shrink-0">
                    Live
                  </span>
                )}
              </div>

              <div className={cn('text-xs', isOpenRouter ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                {keyMetric}
              </div>

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
            </div>
          );
        })}
      </div>
    </div>
  );
}
