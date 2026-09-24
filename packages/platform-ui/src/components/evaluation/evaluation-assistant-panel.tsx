'use client';

import * as React from 'react';
import { Bot, Check, Loader2, Send, Settings, Sparkles, User, X } from 'lucide-react';
import { EVALUATION_ASSISTANT_DEFAULT_MODEL } from '@mediforce/platform-core';
import type {
  EvaluatedStep,
  EvaluationAssistantPlatformToolName,
  EvaluationAssistantProposalToolName,
} from '@mediforce/platform-core';
import type { EvaluationAssistantProgress, PreparedEvalRun, ProposalView } from '@mediforce/platform-api/contract';
import { useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { ModelPicker } from '@/components/workflows/workflow-editor/model-picker';
import { selectBase } from '@/components/workflows/workflow-editor/step-editor-fields';
import { StartEvalRunCard } from './step-evaluation-sections';
import {
  ControlSettingsCard,
  LabellingCard,
  PlanCard,
  ProposalCard,
  isDecidable,
  type ProposalStatus,
} from './evaluation-assistant-cards';

interface ProposalState {
  readonly proposal: ProposalView;
  readonly status: ProposalStatus;
}

interface ActivityStep {
  readonly callId: string;
  readonly tool: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly error?: string;
}

interface Activity {
  readonly steps: ActivityStep[];
  readonly thinking: boolean;
}

interface PanelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly proposals?: ProposalState[];
  readonly prepared?: PreparedEvalRun[];
  readonly steps?: ActivityStep[];
}

const IDLE_ACTIVITY: Activity = { steps: [], thinking: true };
// How close to the bottom (px) still counts as reading the latest message.
const FOLLOW_LATEST_THRESHOLD = 48;

const TOOL_LABELS: Record<EvaluationAssistantPlatformToolName | EvaluationAssistantProposalToolName, string> = {
  get_step: 'Reading the step',
  list_step_runs: 'Listing recent runs',
  get_agent_run: 'Reading an agent run',
  get_trajectory: 'Reading a run trajectory',
  list_workspace_files: 'Listing a run\'s workspace files',
  read_workspace_file: 'Reading a workspace file',
  list_evaluators: 'Listing evaluators',
  get_calibration: 'Reading a judge\'s calibration',
  list_eval_cases: 'Listing eval cases',
  list_eval_runs: 'Listing eval runs',
  get_eval_run_report: 'Reading an eval run report',
  preview_evaluator: 'Previewing a check on real runs',
  prepare_eval_run: 'Preparing an eval run',
  start_eval_run: 'Starting an eval run',
  compare_variants: 'Comparing variants',
  get_qualification: 'Reading the step\'s qualification',
  propose_evaluation_plan: 'Drafting an evaluation plan',
  propose_evaluator: 'Drafting an evaluator',
  propose_evaluator_version: 'Drafting a new evaluator version',
  propose_eval_case: 'Drafting an eval case',
  propose_perturbed_case: 'Synthesizing an eval case',
  propose_outputs_to_label: 'Picking outputs to label',
  propose_brief: 'Drafting the brief',
  propose_acceptance_criteria: 'Drafting Acceptance Criteria',
  propose_control_settings: 'Recommending routing',
};

function toolLabel(tool: string): string {
  return Object.hasOwn(TOOL_LABELS, tool) ? TOOL_LABELS[tool as keyof typeof TOOL_LABELS] : tool;
}

function applyProgress(activity: Activity, event: EvaluationAssistantProgress): Activity {
  if (event.type === 'thinking') return { ...activity, thinking: true };
  if (event.status === 'running') {
    return { thinking: false, steps: [...activity.steps, { callId: event.callId, tool: event.tool, status: 'running' }] };
  }
  return {
    ...activity,
    steps: activity.steps.map((step) => step.callId === event.callId ? { ...step, status: event.status, error: event.error } : step),
  };
}

function ActivityRow({ step }: { step: ActivityStep }) {
  return (
    <li className="flex min-w-0 items-start gap-1.5" data-testid="assistant-activity-step">
      {step.status === 'running' && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />}
      {step.status === 'done' && <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-700 dark:text-green-400" />}
      {step.status === 'failed' && <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
      <span className="min-w-0">
        {toolLabel(step.tool)}
        {step.error !== undefined && <span className="block truncate text-destructive" title={step.error}>{step.error}</span>}
      </span>
    </li>
  );
}

function StepsSummary({ steps }: { steps: ActivityStep[] }) {
  const failed = steps.filter((step) => step.status === 'failed').length;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {steps.length} {steps.length === 1 ? 'step' : 'steps'}{failed > 0 ? ` · ${failed} failed` : ''}
      </summary>
      <ul className="mt-1 space-y-0.5 pl-1">
        {steps.map((step) => <ActivityRow key={step.callId} step={step} />)}
      </ul>
    </details>
  );
}

/**
 * The Evaluation Assistant (ADR-0023 D14–D15) beside the Step's evaluation.
 * It reads and previews on its own; everything it would change arrives as a
 * card — a plan to draft checks from, outputs for the person to label, or a
 * proposal to accept — and an Eval Run it prepares starts only when the
 * person confirms the budget on the card.
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
  const [activity, setActivity] = React.useState<Activity>(IDLE_ACTIVITY);
  const [error, setError] = React.useState<string | null>(null);
  const [assistantModel, setAssistantModel] = React.useState<string | undefined>(undefined);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = React.useState(false);
  const assistantScrollRef = React.useRef<HTMLDivElement>(null);
  const followLatest = React.useRef(true);
  const queryClient = useQueryClient();

  // Follow new messages and steps only while the person is at the bottom; deciding
  // on a proposal changes a message in place and must not move the view.
  React.useEffect(() => {
    const element = assistantScrollRef.current;
    if (element === null || followLatest.current === false) return;
    element.scrollTo({ top: element.scrollHeight });
  }, [messages.length, pending, activity]);

  const decide = (messageIndex: number, proposalIndex: number, status: ProposalStatus) => {
    setMessages((current) => current.map((message, index) => index !== messageIndex ? message : {
      ...message,
      proposals: message.proposals?.map((state, stateIndex) => stateIndex === proposalIndex ? { ...state, status } : state),
    }));
  };

  /** Sends a message; one from a card leaves whatever the person is typing in the input. */
  const send = async (message: string, from: 'input' | 'card') => {
    const content = message.trim();
    if (content === '' || pending) return;
    const thread: PanelMessage[] = [...messages, { role: 'user', content }];
    setMessages(thread);
    if (from === 'input') setInput('');
    setPending(true);
    setActivity(IDLE_ACTIVITY);
    setError(null);
    followLatest.current = true;
    let turnActivity = IDLE_ACTIVITY;
    try {
      const result = await mediforce.evaluation.askAssistant({
        ...step,
        messages: thread.map((message) => ({
          role: message.role,
          content: [message.content, ...(message.proposals ?? []).map(({ proposal }) => `[proposal: ${JSON.stringify(proposal)}]`)].join('\n'),
        })),
        ...(assistantModel === undefined ? {} : { model: assistantModel }),
      }, {
        onProgress: (event) => {
          turnActivity = applyProgress(turnActivity, event);
          setActivity(turnActivity);
        },
      });
      if (result.preparedEvalRuns.length > 0) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.evaluation.step(step.namespace, step.workflowName, step.stepId) });
      }
      setMessages([...thread, {
        role: 'assistant',
        content: result.reply,
        proposals: result.proposals.map((proposal) => ({ proposal, status: 'open' as const })),
        prepared: result.preparedEvalRuns,
        steps: turnActivity.steps,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant did not answer.');
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border bg-white shadow-lg dark:bg-background" data-testid="evaluation-assistant">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Evaluation Assistant</span>
        </div>
        <button
          type="button"
          onClick={() => setAssistantSettingsOpen((current) => !current)}
          className={cn('rounded-md p-1 transition-colors hover:bg-muted', assistantSettingsOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
          title="Assistant settings"
          aria-label="Assistant settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
      {assistantSettingsOpen && (
        <div className="shrink-0 space-y-1.5 border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">Model</span>
          <ModelPicker
            value={assistantModel}
            onChange={setAssistantModel}
            defaultModel={EVALUATION_ASSISTANT_DEFAULT_MODEL}
            requireToolSupport
            minContextTokens={32000}
            ariaLabel="Evaluation Assistant Model"
            className={selectBase}
          />
        </div>
      )}
      <div
        ref={assistantScrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_LATEST_THRESHOLD;
        }}
      >
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask for an evaluation plan, turn a rule into a check tried on real runs, pick outputs for you to label,
            synthesize edge cases, prepare an Eval Run or explain a report. It proposes; you decide.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={cn('flex gap-2 text-sm', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', message.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
              {message.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            </div>
            <div className="flex min-w-0 max-w-[88%] flex-col gap-1.5">
              {message.steps !== undefined && message.steps.length > 0 && <StepsSummary steps={message.steps} />}
              {message.content !== '' && (
                <div className={cn('rounded-lg px-3 py-2 break-words', message.role === 'user' ? 'bg-primary/10 whitespace-pre-wrap' : 'bg-muted')}>
                  {message.role === 'user' ? message.content : <MarkdownPresentation content={message.content} />}
                </div>
              )}
              {message.proposals?.map((state, proposalIndex) => {
                const { proposal } = state;
                if (proposal.tool === 'propose_evaluation_plan') {
                  return (
                    <PlanCard
                      key={proposalIndex}
                      step={step}
                      plan={proposal.arguments}
                      busy={pending}
                      onDraft={(draft) => void send(draft, 'card')}
                      mayEdit={mayEdit}
                      editReason={editReason}
                    />
                  );
                }
                if (proposal.tool === 'propose_control_settings') {
                  return <ControlSettingsCard key={proposalIndex} proposal={proposal.arguments} />;
                }
                if (proposal.tool === 'propose_outputs_to_label') {
                  return <LabellingCard key={proposalIndex} step={step} proposal={proposal.arguments} mayEdit={mayEdit} editReason={editReason} />;
                }
                return isDecidable(proposal) && (
                  <ProposalCard
                    key={proposalIndex}
                    step={step}
                    state={{ proposal, status: state.status }}
                    mayEdit={mayEdit}
                    editReason={editReason}
                    onDecided={(status) => decide(index, proposalIndex, status)}
                  />
                );
              })}
              {message.prepared?.map((prepared) => <StartEvalRunCard key={prepared.evalRunId} step={step} prepared={prepared} mayRun={mayRun} runReason={runReason} />)}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex gap-2 text-sm" data-testid="evaluation-assistant-activity">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bot className="h-3 w-3" />
            </div>
            <ul className="min-w-0 max-w-[88%] space-y-0.5 pt-1 text-xs text-muted-foreground">
              {activity.steps.map((activityStep) => <ActivityRow key={activityStep.callId} step={activityStep} />)}
              {activity.thinking && (
                <li className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  {activity.steps.length === 0 ? 'Thinking…' : 'Deciding the next step…'}
                </li>
              )}
            </ul>
          </div>
        )}
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2 border-t p-2">
        <textarea
          data-testid="evaluation-assistant-input"
          className="min-h-9 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm"
          rows={2}
          placeholder="What should I check on this step?"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey === false) {
              event.preventDefault();
              void send(input, 'input');
            }
          }}
        />
        <button type="button" data-testid="evaluation-assistant-send" aria-label="Send" className="rounded-md bg-primary px-2.5 text-primary-foreground disabled:opacity-50" disabled={pending || input.trim() === ''} onClick={() => void send(input, 'input')}>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
