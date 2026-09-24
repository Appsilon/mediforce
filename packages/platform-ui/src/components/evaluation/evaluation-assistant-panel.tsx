'use client';

import * as React from 'react';
import { Bot, Check, Loader2, Send, User, X } from 'lucide-react';
import type { EvaluatedStep, EvaluationAssistantProposal } from '@mediforce/platform-core';
import type { PreparedEvalRun } from '@mediforce/platform-api/contract';
import { useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { StartEvalRunCard } from './step-evaluation-sections';

type ProposalStatus = 'open' | 'accepted' | 'rejected';

interface ProposalState {
  readonly proposal: EvaluationAssistantProposal;
  readonly status: ProposalStatus;
}

interface PanelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly proposals?: ProposalState[];
  readonly prepared?: PreparedEvalRun[];
}

const TITLES: Record<EvaluationAssistantProposal['tool'], string> = {
  propose_evaluator: 'Evaluator',
  propose_eval_case: 'Eval Case',
  propose_brief: 'Evaluation Brief',
};

/** Accepting a proposal is the same write a person's own form makes, marked as the assistant's. */
async function acceptProposal(step: EvaluatedStep, proposal: EvaluationAssistantProposal): Promise<unknown> {
  switch (proposal.tool) {
    case 'propose_evaluator': {
      const { rationale: _rationale, ...evaluator } = proposal.arguments;
      return mediforce.evaluation.createEvaluator({ ...step, ...evaluator, origin: 'assistant' });
    }
    case 'propose_eval_case': {
      const { agentRunId, input, name, expectation, notes, split } = proposal.arguments;
      return agentRunId !== undefined
        ? mediforce.evaluation.createCaseFromAgentRun({ agentRunId, step, name, expectation, notes, split, origin: 'assistant' })
        : mediforce.evaluation.createCase({ ...step, name, input: input!, expectation, notes: notes ?? null, split, origin: 'assistant' });
    }
    case 'propose_brief':
      return mediforce.evaluation.setBrief({ ...step, text: proposal.arguments.text, origin: 'assistant' });
  }
}

function ProposalCard({ step, state, mayEdit, editReason, onDecided }: {
  step: EvaluatedStep;
  state: ProposalState;
  mayEdit: boolean;
  editReason: string | undefined;
  onDecided: (status: ProposalStatus) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const accept = useStepEvaluationMutation(step, (proposal: EvaluationAssistantProposal) => acceptProposal(step, proposal));
  const { proposal } = state;
  const summary = proposal.tool === 'propose_brief'
    ? proposal.arguments.text
    : proposal.tool === 'propose_evaluator'
      ? `${proposal.arguments.name} (${proposal.arguments.check.kind}, ${proposal.arguments.severity}) — ${proposal.arguments.rule}`
      : `${proposal.arguments.name} — ${proposal.arguments.expectation}`;

  const onAccept = () => {
    let decided = proposal;
    if (editing !== null) {
      try {
        decided = { tool: proposal.tool, arguments: JSON.parse(editing) } as EvaluationAssistantProposal;
      } catch {
        setError('Not valid JSON.');
        return;
      }
    }
    setError(null);
    accept.mutate(decided, {
      onSuccess: () => onDecided('accepted'),
      onError: (err) => setError(err.message),
    });
  };

  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="proposal-card">
      <div className="mb-1 font-medium">Proposed {TITLES[proposal.tool]}</div>
      {editing === null ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{summary}</p>
      ) : (
        <textarea className="w-full min-h-32 rounded border bg-background p-1.5 font-mono" value={editing} onChange={(event) => setEditing(event.target.value)} />
      )}
      {error !== null && <p className="mt-1 text-destructive">{error}</p>}
      {state.status === 'open' ? (
        <div className="mt-2 flex gap-1.5">
          <InstantTooltip label={editReason}>
            <span className="inline-flex">
              <button
                type="button"
                data-testid="proposal-accept"
                className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50 disabled:pointer-events-none"
                disabled={!mayEdit || accept.isPending}
                onClick={onAccept}
              >
                <Check className="h-3 w-3" />Accept
              </button>
            </span>
          </InstantTooltip>
          {mayEdit && editing === null && (
            <button type="button" className="rounded border px-2 py-0.5" onClick={() => setEditing(JSON.stringify(proposal.arguments, null, 2))}>Edit</button>
          )}
          <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-0.5" onClick={() => onDecided('rejected')}>
            <X className="h-3 w-3" />Reject
          </button>
        </div>
      ) : (
        <p className={cn('mt-1.5 font-medium', state.status === 'accepted' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
          {state.status === 'accepted' ? 'Accepted' : 'Rejected'}
        </p>
      )}
    </div>
  );
}

/**
 * The Evaluation Assistant (ADR-0023 D14–D15) beside the Step's evaluation.
 * It reads and previews on its own; everything it would change arrives as a
 * card, and an Eval Run it prepares starts only when the person confirms the
 * budget on the card.
 */
export function EvaluationAssistantPanel({ step, mayEdit, editReason, mayRun, runReason }: {
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const [messages, setMessages] = React.useState<PanelMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const decide = (messageIndex: number, proposalIndex: number, status: ProposalStatus) => {
    setMessages((current) => current.map((message, index) => index !== messageIndex ? message : {
      ...message,
      proposals: message.proposals?.map((state, stateIndex) => stateIndex === proposalIndex ? { ...state, status } : state),
    }));
  };

  const send = async () => {
    const content = input.trim();
    if (content === '' || pending) return;
    const thread: PanelMessage[] = [...messages, { role: 'user', content }];
    setMessages(thread);
    setInput('');
    setPending(true);
    setError(null);
    try {
      const result = await mediforce.evaluation.askAssistant({
        ...step,
        messages: thread.map((message) => ({ role: message.role, content: message.content })),
      });
      if (result.preparedEvalRuns.length > 0) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.evaluation.step(step.namespace, step.workflowName, step.stepId) });
      }
      setMessages([...thread, {
        role: 'assistant',
        content: result.reply,
        proposals: result.proposals.map((proposal) => ({ proposal, status: 'open' as const })),
        prepared: result.preparedEvalRuns,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant did not answer.');
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="flex h-full min-h-[480px] flex-col rounded-lg border" data-testid="evaluation-assistant">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold"><Bot className="h-4 w-4" />Evaluation Assistant</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask what to check, have it draft Evaluators and cases from real runs, prepare an Eval Run or explain a report.
            It proposes; you decide.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={cn('flex gap-2 text-sm', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', message.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
              {message.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            </div>
            <div className="flex min-w-0 max-w-[88%] flex-col gap-1.5">
              {message.content !== '' && (
                <div className={cn('rounded-lg px-3 py-2 break-words', message.role === 'user' ? 'bg-primary/10 whitespace-pre-wrap' : 'bg-muted')}>
                  {message.role === 'user' ? message.content : <MarkdownPresentation content={message.content} />}
                </div>
              )}
              {message.proposals?.map((state, proposalIndex) => (
                <ProposalCard key={proposalIndex} step={step} state={state} mayEdit={mayEdit} editReason={editReason} onDecided={(status) => decide(index, proposalIndex, status)} />
              ))}
              {message.prepared?.map((prepared) => <StartEvalRunCard key={prepared.evalRunId} step={step} prepared={prepared} mayRun={mayRun} runReason={runReason} />)}
            </div>
          </div>
        ))}
        {pending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Working…</div>}
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex gap-2 border-t p-2">
        <textarea
          data-testid="evaluation-assistant-input"
          className="min-h-9 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm"
          rows={2}
          placeholder="What should I check on this step?"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" data-testid="evaluation-assistant-send" aria-label="Send" className="rounded-md bg-primary px-2.5 text-primary-foreground disabled:opacity-50" disabled={pending || input.trim() === ''} onClick={() => void send()}>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
