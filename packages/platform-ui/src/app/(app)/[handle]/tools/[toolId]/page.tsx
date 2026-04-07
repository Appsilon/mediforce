'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Plug, Terminal, Lock } from 'lucide-react';
import { getToolById } from '@/lib/tool-catalog-seed';

export default function ToolDetailPage() {
  const { handle, toolId } = useParams<{ handle: string; toolId: string }>();
  const tool = getToolById(toolId);

  if (!tool) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Tool not found.</p>
        <Link href={`/${handle}/tools`} className="mt-2 text-sm text-primary hover:underline">
          Back to Tools
        </Link>
      </div>
    );
  }

  const secrets = tool.env ? Object.entries(tool.env) : [];

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* Back link */}
        <Link
          href={`/${handle}/tools`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Tools
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-headline font-semibold">{tool.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{tool.description}</p>
        </div>

        {/* Connection */}
        <div className="rounded-lg border bg-card px-4 py-5 mb-6">
          <h2 className="text-sm font-semibold mb-3">Connection</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Transport:</span>
              <span className="text-xs font-medium">stdio</span>
            </div>
            <div className="flex items-start gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <span className="text-xs text-muted-foreground">Command:</span>
                <code className="ml-2 text-xs font-mono bg-muted px-2 py-1 rounded">{tool.command} {tool.args.join(' ')}</code>
              </div>
            </div>
          </div>
        </div>

        {/* Secrets */}
        {secrets.length > 0 && (
          <div className="rounded-lg border bg-card px-4 py-5 mb-6">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-500" />
              Required Secrets
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Resolved at runtime from workflow secrets or environment variables.
            </p>
            <div className="space-y-2">
              {secrets.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    <code className="text-sm font-mono">{key}</code>
                  </div>
                  <code className="text-[11px] font-mono text-muted-foreground">{value}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Access control */}
        {tool.allowedTools && tool.allowedTools.length > 0 && (
          <div className="rounded-lg border bg-card px-4 py-5 mb-6">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Tool Allowlist
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Only these tools from this MCP server are available to agents. Enforced via <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">--allowedTools</code> CLI flag.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tool.allowedTools.map((name) => (
                <code key={name} className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-2 py-1 text-xs font-mono text-emerald-700 dark:text-emerald-300">
                  {name}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Usage */}
        <div className="rounded-lg border bg-card px-4 py-5">
          <h2 className="text-sm font-semibold mb-3">Usage in Workflow Definition</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Add this tool to a workflow step in the <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">mcpServers</code> config:
          </p>
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
{JSON.stringify({
  agent: {
    mcpServers: [{
      name: tool.name.toLowerCase().replace(/\s+/g, '-'),
      command: tool.command,
      args: tool.args,
      ...(tool.env ? { env: tool.env } : {}),
      ...(tool.allowedTools ? { allowedTools: tool.allowedTools } : {}),
    }],
  },
}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
