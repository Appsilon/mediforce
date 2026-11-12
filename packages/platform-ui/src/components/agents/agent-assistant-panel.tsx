'use client';

import * as React from 'react';
import { Bot, Check, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Send, Settings, Sparkles, Square, User, X } from 'lucide-react';
import Link from 'next/link';
import type { AgentAssistantPlatformToolName, AgentAssistantProposalToolName, WorkflowDefinition } from '@mediforce/platform-core';
import type { AgentAssistantProgress, AgentProposalEvidence, AskAgentAssistantOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';
import { errorMessage } from '@/lib/error-message';
import { ModelPicker } from '@/components/workflows/workflow-editor/model-picker';
import { useDefaultModel, usePinnedDefaultModel } from '@/hooks/use-model-registry';
import { selectBase } from '@/components/workflows/workflow-editor/step-editor-fields';
import { selectAgentPatch } from '@/components/workflows/workflow-editor-utils';
import { buildRegisterBody } from '@/lib/workflow-save-utils';
import { VALIDATION_STATUS } from '@/components/evaluation/validation-status';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';

type Proposal = AskAgentAssistantOutput['proposals'][number];

interface ActivityStep {
  readonly callId: string;
  readonly tool: string;
  readonly status: 'running' | 'done' | 'failed';
}

interface PanelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly proposals?: {
    proposal: Proposal;
    status: 'pending' | 'accepted' | 'rejected';
    busy?: boolean;
    error?: string;
    createdAgentId?: string;
    draft?: { name: string; description: string; systemPrompt: string };
  }[];
  readonly steps?: ActivityStep[];
}

const TOOL_LABELS: Record<AgentAssistantPlatformToolName | AgentAssistantProposalToolName, string> = {
  list_agents: 'Listing agents',
  read_agent: 'Reading an agent',
  search_skill_catalog: 'Searching the Skill catalog',
  search_mcp_catalog: 'Searching the MCP catalog',
  propose_agent_match: 'Proposing a matching agent',
  propose_agent_change: 'Proposing an agent change',
  propose_new_agent: 'Drafting a new agent',
  propose_mcp_binding: 'Proposing an MCP server',
  propose_requirement_matrix: 'Scoring candidates against requirements',
};

// Rotates while the turn has no tool call yet, matching the Workflow Assistant pane's status line.
const THINKING_PHASES = ['Thinking…', 'Reading what you asked for…', 'Searching the catalog…'] as const;

const VERDICT_GLYPH: Record<'y' | 'p' | 'n', { label: string; className: string }> = {
  y: { label: '✓', className: 'text-green-700 dark:text-green-400' },
  p: { label: '◐', className: 'text-amber-600 dark:text-amber-400' },
  n: { label: '✕', className: 'text-destructive' },
};

function toolLabel(tool: string): string {
  return Object.hasOwn(TOOL_LABELS, tool) ? TOOL_LABELS[tool as keyof typeof TOOL_LABELS] : tool;
}

function skillManifest(id: string, description: string, body: string): string {
  return `---\nname: ${id}\ndescription: ${JSON.stringify(description)}\n---\n${body}\n`;
}

/** Real evidence behind a match or change proposal — never the model's own claim. */
function EvidenceRow({ evidence }: { evidence: AgentProposalEvidence | undefined }) {
  if (evidence === undefined) return null;
  const display = evidence.qualification === null ? null : VALIDATION_STATUS[evidence.qualification];
  return (
    <dl className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
      <div className="flex gap-1">
        <dt className="font-medium">Qualification:</dt>
        <dd className={display?.textClassName}>{display?.versionLabel ?? 'Not evaluated'}</dd>
      </div>
      {evidence.usedIn.length > 0 && (
        <div className="flex gap-1">
          <dt className="shrink-0 font-medium">Used in:</dt>
          <dd>{evidence.usedIn.join(', ')}</dd>
        </div>
      )}
    </dl>
  );
}

interface AgentStepOption {
  readonly key: string;
  readonly label: string;
  readonly definition: WorkflowDefinition;
  readonly stepId: string;
}

export function UseInWorkflowStep({ namespace, agentId }: { namespace: string; agentId: string }) {
  const pinnedDefaultModel = usePinnedDefaultModel(namespace);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [binding, setBinding] = React.useState(false);
  const [options, setOptions] = React.useState<AgentStepOption[]>([]);
  const [selected, setSelected] = React.useState('');
  const [bound, setBound] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function reveal() {
    setOpen(true);
    if (options.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { definitions } = await mediforce.workflows.list({ namespace });
      const found: AgentStepOption[] = [];
      for (const group of definitions) {
        if (group.definition === null) continue;
        for (const step of group.definition.steps) {
          if (step.executor === 'agent') {
            found.push({ key: `${group.name}:${step.id}`, label: `${group.name} — ${step.name}`, definition: group.definition, stepId: step.id });
          }
        }
      }
      setOptions(found);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load workflow steps.'));
    } finally {
      setLoading(false);
    }
  }

  async function bind() {
    const target = options.find((option) => option.key === selected);
    if (target === undefined) return;
    setBinding(true);
    setError(null);
    try {
      const { agent } = await mediforce.agents.get({ id: agentId });
      const step = target.definition.steps.find((candidate) => candidate.id === target.stepId);
      if (step === undefined) return;
      const patch = selectAgentPatch(step, agent, pinnedDefaultModel);
      const steps = target.definition.steps.map((candidate) => candidate.id === target.stepId ? { ...candidate, ...patch } : candidate);
      await mediforce.workflows.register(buildRegisterBody(target.definition, { steps }), { namespace });
      setBound(target.label);
    } catch (err) {
      setError(errorMessage(err, 'Failed to bind the step.'));
    } finally {
      setBinding(false);
    }
  }

  if (bound !== null) {
    return <p className="text-green-700 dark:text-green-400">Bound to {bound}</p>;
  }
  if (!open) {
    return <button type="button" className="text-primary underline" onClick={() => void reveal()}>Use in a workflow step</button>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <select
        className={cn(selectBase, 'w-auto')}
        value={selected}
        disabled={loading}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">{loading ? 'Loading steps…' : 'Choose a step…'}</option>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <button type="button" className="rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50" disabled={selected === '' || binding} onClick={() => void bind()}>
        {binding ? 'Binding…' : 'Bind'}
      </button>
      {error !== null && <span className="text-destructive">{error}</span>}
    </div>
  );
}

function FollowUps({ namespace, agentId }: { namespace: string; agentId: string }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link href={routes.agentDefinition(namespace, agentId)} className="text-primary underline">
        Open agent
      </Link>
      <Link href={`/${namespace}/workflows/new?agentId=${agentId}`} className="text-primary underline">
        Start a workflow with it
      </Link>
      <UseInWorkflowStep namespace={namespace} agentId={agentId} />
    </div>
  );
}

/** Which agent a tool call is about, for the catalog grid to highlight — undefined for calls that touch no single agent. */
function agentIdFromEvent(tool: string, args: unknown): string | undefined {
  const value = args as Record<string, unknown> | undefined;
  if (tool === 'read_agent' && typeof value?.id === 'string') return value.id;
  if ((tool === 'propose_agent_match' || tool === 'propose_agent_change') && typeof value?.agentId === 'string') return value.agentId;
  return undefined;
}

/** The agent its final proposal names, for the catalog grid to keep highlighted once the turn ends. */
function matchedAgentId(proposals: Proposal[]): string | null {
  for (const proposal of proposals) {
    if (proposal.tool === 'propose_agent_match' || proposal.tool === 'propose_agent_change') {
      return proposal.arguments.agentId;
    }
  }
  return null;
}

/**
 * The Agent Assistant beside the namespace's Agent catalog. It only reads and
 * searches on its own; everything it would change arrives as a proposal card
 * the person accepts — the same create/update a person's own form makes.
 */
export function AgentAssistantPanel({ namespace, open, onToggleOpen, wide, onToggleWide, onActivityChange, onAccepted }: {
  namespace: string;
  /** Whether the pane is expanded — collapsed, it shows as a thin rail, same as the Workflow Assistant. */
  open: boolean;
  onToggleOpen: () => void;
  /** Whether the open pane takes the wider column width — irrelevant while collapsed. */
  wide: boolean;
  onToggleWide: () => void;
  /** Which agent card to glow as "scanning", and which to keep highlighted as the match, while this turn runs. */
  onActivityChange?: (activity: { scanningId: string | null; matchedId: string | null }) => void;
  onAccepted?: () => void;
}) {
  const defaultModel = useDefaultModel(namespace);
  const [messages, setMessages] = React.useState<PanelMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [steps, setSteps] = React.useState<ActivityStep[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [assistantModel, setAssistantModel] = React.useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages.length, pending]);

  // Advance the status label and the elapsed counter while a turn is in flight.
  React.useEffect(() => {
    if (!pending) return;
    setPhase(0);
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      setPhase((current) => Math.min(current + 1, THINKING_PHASES.length - 1));
    }, 2500);
    return () => clearInterval(timer);
  }, [pending]);

  function haltAssistant() {
    abortRef.current?.abort();
  }

  async function send(message: string) {
    const content = message.trim();
    if (content === '' || pending) return;
    const thread: PanelMessage[] = [...messages, { role: 'user', content }];
    setMessages(thread);
    setInput('');
    setPending(true);
    setError(null);
    let turnSteps: ActivityStep[] = [];
    setSteps(turnSteps);
    onActivityChange?.({ scanningId: null, matchedId: null });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await mediforce.agents.askAssistant({
        namespace,
        messages: thread.map((entry) => ({ role: entry.role, content: entry.content })),
        ...(assistantModel === undefined ? {} : { model: assistantModel }),
      }, {
        signal: controller.signal,
        onProgress: (event: AgentAssistantProgress) => {
          if (event.type !== 'tool') return;
          const existing = turnSteps.find((step) => step.callId === event.callId);
          turnSteps = existing === undefined
            ? [...turnSteps, { callId: event.callId, tool: event.tool, status: event.status }]
            : turnSteps.map((step) => step.callId === event.callId ? { ...step, status: event.status } : step);
          setSteps(turnSteps);
          if (event.status === 'running') {
            onActivityChange?.({ scanningId: agentIdFromEvent(event.tool, event.arguments) ?? null, matchedId: null });
          }
        },
      });
      setMessages([...thread, {
        role: 'assistant',
        content: result.reply,
        proposals: result.proposals.map((proposal) => ({ proposal, status: 'pending' as const })),
        steps: turnSteps,
      }]);
      onActivityChange?.({ scanningId: null, matchedId: matchedAgentId(result.proposals) });
    } catch (err) {
      // Halted on purpose: said in the thread rather than as an error, same as the Workflow Assistant pane.
      if (controller.signal.aborted) {
        setMessages([...thread, { role: 'assistant', content: 'Stopped. Nothing was created or changed.' }]);
      } else {
        setError(errorMessage(err, 'The assistant did not answer.'));
      }
      onActivityChange?.({ scanningId: null, matchedId: null });
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  function setProposalState(messageIndex: number, proposalIndex: number, patch: Partial<Omit<NonNullable<PanelMessage['proposals']>[number], 'proposal'>>) {
    setMessages((current) => current.map((message, index) => index !== messageIndex ? message : {
      ...message,
      proposals: message.proposals?.map((state, i) => i === proposalIndex ? { ...state, ...patch } : state),
    }));
  }

  /** Runs an accept action with a busy flag and surfaces a failure on the card instead of leaving it silently stuck. */
  async function runAccept(messageIndex: number, proposalIndex: number, action: () => Promise<Partial<Omit<NonNullable<PanelMessage['proposals']>[number], 'proposal'>>>) {
    setProposalState(messageIndex, proposalIndex, { busy: true, error: undefined });
    try {
      const patch = await action();
      setProposalState(messageIndex, proposalIndex, { ...patch, status: 'accepted', busy: false });
    } catch (err) {
      setProposalState(messageIndex, proposalIndex, { busy: false, error: errorMessage(err, 'Failed to accept this proposal.') });
    }
  }

  async function acceptChange(messageIndex: number, proposalIndex: number, proposal: Extract<Proposal, { tool: 'propose_agent_change' }>) {
    await runAccept(messageIndex, proposalIndex, async () => {
      const { agent } = await mediforce.agents.get({ id: proposal.arguments.agentId });
      await mediforce.agents.update({ id: agent.id }, { skills: [...(agent.skills ?? []), proposal.arguments.skill] });
      onAccepted?.();
      return {};
    });
  }

  async function acceptMcpBinding(messageIndex: number, proposalIndex: number, proposal: Extract<Proposal, { tool: 'propose_mcp_binding' }>) {
    await runAccept(messageIndex, proposalIndex, async () => {
      const { entry } = await mediforce.toolCatalog.get({ namespace, id: proposal.arguments.serverId });
      await mediforce.agents.upsertMcpBinding({
        id: proposal.arguments.agentId,
        name: proposal.arguments.serverId,
        binding: { type: entry.type, catalogId: entry.id, status: 'pending' },
      });
      return {};
    });
  }

  async function acceptNewAgent(
    messageIndex: number,
    proposalIndex: number,
    proposal: Extract<Proposal, { tool: 'propose_new_agent' }>,
    draft: { name: string; description: string; systemPrompt: string } | undefined,
  ) {
    await runAccept(messageIndex, proposalIndex, async () => {
      const { newSkill, skills, ...agentFields } = proposal.arguments;
      const fullSkills = [...skills];
      if (newSkill !== undefined) {
        const existing = await mediforce.skills.get({ namespace, id: newSkill.id }).catch(() => null);
        const skill = existing?.skill ?? (await mediforce.skills.create({
          namespace,
          visibility: 'private',
          files: [{ path: 'SKILL.md', contents: skillManifest(newSkill.id, newSkill.description, newSkill.body) }],
        })).skill;
        fullSkills.push({ namespace: skill.namespace, id: skill.id });
      }
      const { agent } = await mediforce.agents.create({
        ...agentFields, ...draft, namespace, visibility: 'private', skills: fullSkills,
      });
      onAccepted?.();
      return { createdAgentId: agent.id };
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex h-full w-10 shrink-0 flex-col items-center justify-between rounded-xl border bg-card py-4 text-muted-foreground shadow-lg transition-colors hover:bg-muted hover:text-foreground"
        title="Expand Agent Assistant"
        aria-label="Expand Agent Assistant"
        data-testid="agent-assistant-rail"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180 select-none">
          Agent Assistant
        </span>
        {pending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <ChevronLeft className="h-4 w-4 shrink-0" />}
      </button>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border bg-card shadow-lg" data-testid="agent-assistant">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Agent Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSettingsOpen((current) => !current)}
            className={cn('rounded-md p-1 transition-colors hover:bg-muted', settingsOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
            title="Assistant settings"
            aria-label="Assistant settings"
            aria-expanded={settingsOpen}
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleWide}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={wide ? 'Narrow the panel' : 'Widen the panel'}
            aria-label={wide ? 'Narrow the panel' : 'Widen the panel'}
          >
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Collapse Agent Assistant"
            aria-label="Collapse Agent Assistant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {settingsOpen && (
        <div className="shrink-0 space-y-1.5 border-b px-4 py-2">
          <p className="text-xs text-muted-foreground">Scope: <span className="font-medium text-foreground">{namespace}</span> catalog only</p>
          <span className="text-xs font-medium text-muted-foreground">Model</span>
          <ModelPicker
            value={assistantModel}
            onChange={setAssistantModel}
            defaultModel={defaultModel}
            requireToolSupport
            minContextTokens={32000}
            ariaLabel="Agent Assistant Model"
            className={selectBase}
          />
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Describe the agent or the task it should do. It searches the catalog first — reuse, extend or a new draft.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={cn('flex gap-2 text-sm', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', message.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
              {message.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            </div>
            <div className="flex min-w-0 max-w-[88%] flex-col gap-1.5">
              {message.steps !== undefined && message.steps.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">{message.steps.length} steps</summary>
                  <ul className="mt-1 space-y-0.5 pl-1">
                    {message.steps.map((step) => (
                      <li key={step.callId} className="flex items-center gap-1.5">
                        {step.status === 'running' && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                        {step.status === 'done' && <Check className="h-3 w-3 shrink-0 text-green-700 dark:text-green-400" />}
                        {toolLabel(step.tool)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {message.content !== '' && (
                <div className={cn('rounded-lg px-3 py-2 break-words', message.role === 'user' ? 'bg-primary/10 whitespace-pre-wrap' : 'bg-muted')}>
                  {/* The model writes markdown; what the person typed is left as plain text, since their newlines are all the structure it has. */}
                  {message.role === 'user' ? message.content : <MarkdownPresentation content={message.content} />}
                </div>
              )}
              {message.proposals?.map((state, proposalIndex) => {
                const { proposal, status, busy, error: proposalError, createdAgentId, draft } = state;
                if (proposal.tool === 'propose_requirement_matrix') {
                  const { requirements, candidates } = proposal.arguments;
                  return (
                    <div key={proposalIndex} className="overflow-x-auto rounded-md border p-2.5 text-xs" data-testid="agent-assistant-matrix-card">
                      <p className="mb-1.5 font-medium">Requirements check</p>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="p-1 text-left font-medium text-muted-foreground">Requirement</th>
                            {candidates.map((candidate) => (
                              <th key={candidate.agentId} className="p-1 text-center font-medium text-muted-foreground">{candidate.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {requirements.map((requirement, requirementIndex) => (
                            <tr key={requirementIndex} className="border-t">
                              <td className="p-1">{requirement}</td>
                              {candidates.map((candidate) => {
                                const cell = candidate.cells[requirementIndex];
                                const glyph = cell === undefined ? undefined : VERDICT_GLYPH[cell.verdict];
                                return (
                                  <td key={candidate.agentId} className="p-1 text-center" title={cell?.evidence}>
                                    {glyph !== undefined && <span className={glyph.className}>{glyph.label}</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
                if (proposal.tool === 'propose_agent_match') {
                  return (
                    <div key={proposalIndex} className="rounded-md border p-2.5 text-xs" data-testid="agent-assistant-match-card">
                      <p className="font-medium">Use an existing agent</p>
                      <p className="mt-0.5 text-muted-foreground">{proposal.arguments.rationale}</p>
                      <EvidenceRow evidence={proposal.evidence} />
                      <FollowUps namespace={namespace} agentId={proposal.arguments.agentId} />
                    </div>
                  );
                }
                if (proposal.tool === 'propose_agent_change') {
                  return (
                    <div key={proposalIndex} className="rounded-md border p-2.5 text-xs" data-testid="agent-assistant-change-card">
                      <p className="font-medium">Add a Skill to this agent</p>
                      <p className="mt-0.5 text-muted-foreground">{proposal.arguments.rationale}</p>
                      <p className="mt-1 font-mono">{proposal.arguments.skill.namespace}/{proposal.arguments.skill.id}</p>
                      <EvidenceRow evidence={proposal.evidence} />
                      {status === 'accepted' && (
                        <>
                          <span className="mt-1.5 inline-flex items-center gap-1 text-green-700 dark:text-green-400"><Check className="h-3 w-3" />Accepted</span>
                          <FollowUps namespace={namespace} agentId={proposal.arguments.agentId} />
                        </>
                      )}
                      {status === 'rejected' && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-muted-foreground"><X className="h-3 w-3" />Rejected</span>
                      )}
                      {status === 'pending' && (
                        <>
                          {proposalError !== undefined && <p className="mt-1.5 text-destructive">{proposalError}</p>}
                          <div className="mt-1.5 flex gap-1.5">
                            <button type="button" disabled={busy === true} className="rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50" onClick={() => void acceptChange(index, proposalIndex, proposal)}>
                              {busy === true ? 'Accepting…' : 'Accept'}
                            </button>
                            <button type="button" disabled={busy === true} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => setProposalState(index, proposalIndex, { status: 'rejected' })}>
                              Reject
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                }
                if (proposal.tool === 'propose_mcp_binding') {
                  return (
                    <div key={proposalIndex} className="rounded-md border p-2.5 text-xs" data-testid="agent-assistant-mcp-card">
                      <p className="font-medium">Wire an MCP server: {proposal.arguments.serverId}</p>
                      <p className="mt-0.5 text-muted-foreground">{proposal.arguments.rationale}</p>
                      {status === 'accepted' && (
                        <p className="mt-1.5 text-amber-600 dark:text-amber-400">Submitted — pending admin approval.</p>
                      )}
                      {status === 'rejected' && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-muted-foreground"><X className="h-3 w-3" />Rejected</span>
                      )}
                      {status === 'pending' && (
                        <>
                          {proposalError !== undefined && <p className="mt-1.5 text-destructive">{proposalError}</p>}
                          <div className="mt-1.5 flex gap-1.5">
                            <button type="button" disabled={busy === true} className="rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50" onClick={() => void acceptMcpBinding(index, proposalIndex, proposal)}>
                              {busy === true ? 'Submitting…' : 'Submit for approval'}
                            </button>
                            <button type="button" disabled={busy === true} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => setProposalState(index, proposalIndex, { status: 'rejected' })}>
                              Reject
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={proposalIndex} className="rounded-md border border-dashed p-2.5 text-xs" data-testid="agent-assistant-new-card">
                    {draft === undefined ? (
                      <>
                        <p className="font-medium">New agent: {proposal.arguments.name}</p>
                        <p className="mt-0.5 text-muted-foreground">{proposal.arguments.description}</p>
                      </>
                    ) : (
                      <div className="space-y-1">
                        <input
                          className="w-full rounded-md border bg-background px-1.5 py-1 font-medium"
                          value={draft.name}
                          onChange={(event) => setProposalState(index, proposalIndex, { draft: { ...draft, name: event.target.value } })}
                        />
                        <textarea
                          className="w-full resize-none rounded-md border bg-background px-1.5 py-1 text-muted-foreground"
                          rows={2}
                          value={draft.description}
                          onChange={(event) => setProposalState(index, proposalIndex, { draft: { ...draft, description: event.target.value } })}
                        />
                      </div>
                    )}
                    <p className="mt-0.5 text-muted-foreground">{proposal.arguments.rationale}</p>
                    {(proposal.arguments.skills.length > 0 || proposal.arguments.newSkill !== undefined) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {proposal.arguments.skills.map((skill) => (
                          <span key={`${skill.namespace}/${skill.id}`} className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                            {skill.namespace}/{skill.id}
                          </span>
                        ))}
                        {proposal.arguments.newSkill !== undefined && (
                          <span className="rounded-full border border-dashed border-primary/50 bg-primary/5 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                            + {proposal.arguments.newSkill.id} (new)
                          </span>
                        )}
                      </div>
                    )}
                    <details className="mt-1.5 text-muted-foreground">
                      <summary className="cursor-pointer select-none">Preview</summary>
                      {proposal.arguments.newSkill !== undefined && (
                        <pre className="mt-1 overflow-x-auto rounded bg-muted p-1.5 whitespace-pre-wrap">
                          {skillManifest(proposal.arguments.newSkill.id, proposal.arguments.newSkill.description, proposal.arguments.newSkill.body)}
                        </pre>
                      )}
                      {draft === undefined ? (
                        <pre className="mt-1 overflow-x-auto rounded bg-muted p-1.5 whitespace-pre-wrap">{proposal.arguments.systemPrompt}</pre>
                      ) : (
                        <textarea
                          className="mt-1 w-full resize-y rounded-md border bg-background p-1.5 font-mono"
                          rows={6}
                          value={draft.systemPrompt}
                          onChange={(event) => setProposalState(index, proposalIndex, { draft: { ...draft, systemPrompt: event.target.value } })}
                        />
                      )}
                    </details>
                    {status === 'accepted' && createdAgentId !== undefined && (
                      <>
                        <span className="mt-1.5 inline-flex items-center gap-1 text-green-700 dark:text-green-400"><Check className="h-3 w-3" />Created</span>
                        <FollowUps namespace={namespace} agentId={createdAgentId} />
                      </>
                    )}
                    {status === 'rejected' && (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-muted-foreground"><X className="h-3 w-3" />Rejected</span>
                    )}
                    {status === 'pending' && (
                      <>
                        {proposalError !== undefined && <p className="mt-1.5 text-destructive">{proposalError}</p>}
                        <div className="mt-1.5 flex gap-1.5">
                          <button type="button" disabled={busy === true} className="rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50" onClick={() => void acceptNewAgent(index, proposalIndex, proposal, draft)}>
                            {busy === true ? 'Creating…' : 'Create draft agent'}
                          </button>
                          <button
                            type="button"
                            disabled={busy === true}
                            className="rounded-md border px-2 py-1 disabled:opacity-50"
                            onClick={() => setProposalState(index, proposalIndex, {
                              draft: draft === undefined
                                ? { name: proposal.arguments.name, description: proposal.arguments.description, systemPrompt: proposal.arguments.systemPrompt }
                                : undefined,
                            })}
                          >
                            {draft === undefined ? 'Edit' : 'Cancel edit'}
                          </button>
                          <button type="button" disabled={busy === true} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => setProposalState(index, proposalIndex, { status: 'rejected' })}>
                            Reject
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="agent-assistant-activity">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1 truncate">
              {steps.length === 0 ? THINKING_PHASES[phase] ?? THINKING_PHASES[0] : 'Deciding the next step…'}
            </span>
            {elapsed > 0 && (
              <span className="shrink-0 tabular-nums text-muted-foreground/70">{formatDuration(elapsed * 1000)}</span>
            )}
            <button
              type="button"
              onClick={haltAssistant}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-muted hover:text-foreground"
              title="Stop the assistant"
              aria-label="Stop the assistant"
            >
              <Square className="h-2 w-2 fill-current" />
            </button>
          </div>
        )}
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2 border-t p-2">
        <textarea
          data-testid="agent-assistant-input"
          className="min-h-9 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm"
          rows={2}
          placeholder="Describe the agent or the task it should do…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey === false) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="button"
          data-testid="agent-assistant-send"
          aria-label="Send"
          className="rounded-md bg-primary px-2.5 text-primary-foreground disabled:opacity-50"
          disabled={pending || input.trim() === ''}
          onClick={() => void send(input)}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
