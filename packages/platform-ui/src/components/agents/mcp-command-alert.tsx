'use client';

import { AlertTriangle } from 'lucide-react';
import { DEFAULT_AGENT_IMAGE } from '@mediforce/platform-core';
import { useImageCommandChecks } from '@/hooks/use-image-catalog';
import { missingCommandWarnings, type McpServerCommand } from './mcp-command-warnings';

/**
 * Warns when an image is known not to provide a command an MCP server runs.
 * Such a server fails to start inside the container and the agent just sees no
 * tools — which is why this says so up front. Advisory only: it never blocks,
 * and renders nothing while a check is unanswered or when the answer is unknown.
 */
export function McpCommandWarnings({
  namespace,
  image,
  servers,
  remedy,
}: {
  namespace: string;
  image: string;
  servers: readonly McpServerCommand[];
  /** What the reader can do about it, in the context they are reading this in. */
  remedy: string;
}) {
  const checks = useImageCommandChecks(namespace, image, servers.map((server) => server.command));
  const warnings = missingCommandWarnings(servers, checks);
  const imageLabel = image === DEFAULT_AGENT_IMAGE ? `the default agent image (${DEFAULT_AGENT_IMAGE})` : `\`${image}\``;
  if (warnings.length === 0) return null;

  return (
    <div role="alert" data-testid="mcp-command-warnings" className="flex flex-col gap-1">
      {warnings.map((warning) => (
        <p
          key={warning.command}
          className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {warning.servers.map((server) => `\`${server}\``).join(', ')}{' '}
            {warning.servers.length === 1 ? 'runs' : 'run'} <code className="font-mono">{warning.command}</code>,
            which {imageLabel} does not provide, so {warning.servers.length === 1 ? 'it' : 'they'}{' '}
            will fail to start and the agent will see no tools from {warning.servers.length === 1 ? 'it' : 'them'}. {remedy}
          </span>
        </p>
      ))}
    </div>
  );
}
