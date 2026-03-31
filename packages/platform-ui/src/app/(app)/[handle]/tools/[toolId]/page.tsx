'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Plug, Terminal, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared catalog data — in production, fetched from Firestore
const TOOL_CATALOG: Record<string, {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description: string;
  allowedTools?: string[];
  category: string;
  allTools: string[];
}> = {
  github: {
    name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: '{{GITHUB_TOKEN}}' },
    description: 'Search code, read files, create issues and pull requests in GitHub repositories.',
    category: 'Development',
    allTools: ['search_code', 'get_file_contents', 'create_issue', 'create_pull_request', 'list_commits', 'get_commit', 'list_branches', 'search_issues'],
  },
  filesystem: {
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
    description: 'Read and write files in a scoped directory.',
    category: 'Data Access',
    allTools: ['read_file', 'write_file', 'list_directory', 'create_directory', 'move_file', 'search_files', 'get_file_info'],
  },
  postgres: {
    name: 'PostgreSQL',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: '{{DATABASE_URL}}' },
    description: 'Execute read-only SQL queries against a PostgreSQL database.',
    allowedTools: ['query'],
    category: 'Data Access',
    allTools: ['query', 'list_tables', 'describe_table', 'execute'],
  },
  slack: {
    name: 'Slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '{{SLACK_BOT_TOKEN}}' },
    description: 'Post messages, read channels, and manage threads in Slack workspaces.',
    category: 'Communication',
    allTools: ['post_message', 'read_channel', 'list_channels', 'add_reaction', 'upload_file'],
  },
  'cdisc-library': {
    name: 'CDISC Library',
    command: 'node',
    args: ['/opt/mcp-servers/cdisc-library/index.js'],
    env: { CDISC_API_KEY: '{{CDISC_API_KEY}}' },
    description: 'Look up SDTM/ADaM variable metadata, controlled terminology, and CDISC standards.',
    category: 'Clinical Data',
    allTools: ['get_variable_metadata', 'search_terminology', 'get_domain_spec', 'list_standards', 'get_codelist'],
  },
  'brave-search': {
    name: 'Brave Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '{{BRAVE_API_KEY}}' },
    description: 'Web search via Brave Search API.',
    category: 'Research',
    allTools: ['web_search', 'local_search'],
  },
};

function ToolRow({ name, isAllowed }: { name: string; isAllowed: boolean }) {
  return (
    <div className={cn(
      'flex items-center justify-between rounded-md border px-3 py-2',
      isAllowed
        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
        : 'border-border bg-muted/30 opacity-50',
    )}>
      <div className="flex items-center gap-2">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <code className="text-sm font-mono">{name}</code>
      </div>
      {isAllowed ? (
        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 uppercase">Available</span>
      ) : (
        <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase">
          <Lock className="h-2.5 w-2.5" />
          Restricted
        </span>
      )}
    </div>
  );
}

export default function ToolDetailPage() {
  const { handle, toolId } = useParams<{ handle: string; toolId: string }>();
  const tool = TOOL_CATALOG[toolId];

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
  const allowedSet = tool.allowedTools ? new Set(tool.allowedTools) : null;

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
              These secrets are resolved at runtime from workflow secrets or environment variables.
              Steps using this tool must have access to these secrets.
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

        {/* Available Tools */}
        <div className="rounded-lg border bg-card px-4 py-5 mb-6">
          <h2 className="text-sm font-semibold mb-1">Available Tools</h2>
          <p className="text-xs text-muted-foreground mb-4">
            {allowedSet
              ? `${allowedSet.size} of ${tool.allTools.length} tools are allowed by default. When assigning to a workflow step, you can further restrict this list.`
              : `All ${tool.allTools.length} tools are available. When assigning to a workflow step, you can restrict which tools the agent can use.`}
          </p>
          <div className="space-y-1.5">
            {tool.allTools.map((name) => (
              <ToolRow
                key={name}
                name={name}
                isAllowed={allowedSet === null || allowedSet.has(name)}
              />
            ))}
          </div>
        </div>

        {/* Usage */}
        <div className="rounded-lg border bg-card px-4 py-5">
          <h2 className="text-sm font-semibold mb-3">Usage in Workflow Definition</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Add this tool to a workflow step by including it in the step&apos;s <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">mcpServers</code> configuration:
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
