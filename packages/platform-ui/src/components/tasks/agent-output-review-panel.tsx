'use client';

import * as React from 'react';
import { AlertTriangle, Bot } from 'lucide-react';
import type { AgentOutputData } from './task-utils';
import { formatStepName } from './task-utils';
import { AgentOutputDisplay } from '@/components/agents/agent-output-display';

interface AgentOutputReviewPanelProps {
  agentOutput: AgentOutputData;
  stepId?: string;
  onContentLoaded?: (hasContent: boolean) => void;
  instanceId: string;
}

/**
 * Review-mode wrapper around {@link AgentOutputDisplay}. Adds only the
 * "Agent Output for Review" label, step name, and the escalation pill. All
 * metrics, git metadata, and tabbed content live inside `AgentOutputDisplay`
 * so the step detail page and the human-review page render the same body.
 */
export function AgentOutputReviewPanel({
  agentOutput,
  stepId,
  onContentLoaded,
  instanceId,
}: AgentOutputReviewPanelProps) {
  const hasResult = agentOutput.result !== null && Object.keys(agentOutput.result).length > 0;
  const hasPresentation = typeof agentOutput.presentation === 'string' && agentOutput.presentation.length > 0;
  const hasContent = hasResult || hasPresentation;

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No agent output to review.
        </p>
      </div>
    );
  }

  const confidencePct = agentOutput.confidence !== null
    ? Math.round(agentOutput.confidence * 100)
    : null;

  return (
    <div className="rounded-lg border">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Bot className="h-4 w-4 text-purple-500" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Agent Output for Review
        </span>
        {stepId && (
          <span className="text-xs font-medium text-foreground">
            — {formatStepName(stepId)}
          </span>
        )}
        {agentOutput.escalationReason !== null && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            title={`Agent escalated to human because of ${agentOutput.escalationReason.replace(/_/g, ' ')}. Review the recommendation and approve or request revision.`}
          >
            <AlertTriangle className="h-3 w-3" />
            Escalated: {formatEscalationReason(agentOutput.escalationReason)}
            {agentOutput.escalationReason === 'low_confidence' && confidencePct !== null && ` (${confidencePct}%)`}
          </span>
        )}
      </div>

      <AgentOutputDisplay
        agentOutput={agentOutput}
        instanceId={instanceId}
        onContentLoaded={onContentLoaded}
      />
    </div>
  );
}

function formatEscalationReason(reason: 'low_confidence' | 'timeout' | 'error' | 'iterations_limit'): string {
  switch (reason) {
    case 'low_confidence': return 'low confidence';
    case 'timeout': return 'timeout';
    case 'error': return 'error';
    case 'iterations_limit': return 'iterations limit reached';
  }
}
