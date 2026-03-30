'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Send, Loader2, Bot, User, CheckCircle, AlertCircle,
  Info, ChevronDown, Lock, ArrowRight, Check, Circle,
} from 'lucide-react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { cn } from '@/lib/utils';
import { sendMessage, finalizeSession } from '@/app/actions/cowork';
import { routes } from '@/lib/routes';
import type { CoworkSession, ConversationTurn, ProcessInstance } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationViewProps {
  session: CoworkSession;
  instance: ProcessInstance | null;
  handle: string;
  stepDescription?: string;
}

// ---------------------------------------------------------------------------
// Thinking indicator with elapsed timer
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn('flex gap-2.5 flex-row')}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="rounded-lg bg-muted px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Thinking
          <span className="font-mono text-xs">{elapsed}s</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat message bubble
// ---------------------------------------------------------------------------

function ChatBubble({ turn }: { turn: ConversationTurn }) {
  const isHuman = turn.role === 'human';

  return (
    <div className={cn('flex gap-2.5', isHuman ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs',
          isHuman
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {isHuman ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          isHuman ? 'bg-primary/10' : 'bg-muted',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{turn.content}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System prompt bubble (step description)
// ---------------------------------------------------------------------------

function StepDescriptionBubble({ description }: { description: string }) {
  return (
    <div className="flex gap-2.5 flex-row">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <Info className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[90%] rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
        <p className="whitespace-pre-wrap break-words">{description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context panel (foldable)
// ---------------------------------------------------------------------------

function ContextPanel({
  instance,
  session,
  handle,
}: {
  instance: ProcessInstance | null;
  session: CoworkSession;
  handle: string;
}) {
  const [open, setOpen] = React.useState(true);

  const previousStepOutput = React.useMemo(() => {
    if (!instance) return null;
    const vars = instance.variables as Record<string, unknown>;
    const keys = Object.keys(vars);
    if (keys.length === 0) return null;
    return vars;
  }, [instance]);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors rounded-t-lg border border-b-0 rounded-b-none bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Session Context
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="border border-t-0 rounded-b-lg px-4 py-3 space-y-3 text-sm bg-muted/10">
          {/* Metadata grid */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Run</div>
              {instance ? (
                <Link
                  href={routes.workflowRun(handle, instance.definitionName, instance.id)}
                  className="text-primary hover:underline font-mono text-xs"
                >
                  {instance.id.slice(0, 8)}...
                </Link>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">{session.processInstanceId.slice(0, 8)}...</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Step</div>
              <span className="text-xs">{session.stepId}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Role</div>
              <span className="text-xs">{session.assignedRole}</span>
            </div>
          </div>

          {/* Previous step output */}
          {previousStepOutput && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Previous step output</div>
              <pre className="rounded-md bg-muted p-2 text-xs overflow-auto max-h-32 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(previousStepOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// ---------------------------------------------------------------------------
// Artifact requirements validation
// ---------------------------------------------------------------------------

function getRequiredFields(outputSchema: Record<string, unknown> | null): string[] {
  if (!outputSchema) return [];
  const required = outputSchema.required;
  if (Array.isArray(required)) return required as string[];
  return [];
}

function checkRequiredFields(
  artifact: Record<string, unknown> | null,
  requiredFields: string[],
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const field of requiredFields) {
    const value = artifact?.[field];
    const present = value !== undefined && value !== null &&
      !(Array.isArray(value) && value.length === 0) &&
      !(typeof value === 'string' && value.trim().length === 0);
    result.set(field, present);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Artifact preview panel
// ---------------------------------------------------------------------------

function ArtifactPanel({
  artifact,
  outputSchema,
  onFinalize,
  finalizing,
  finalized,
}: {
  artifact: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  onFinalize: () => void;
  finalizing: boolean;
  finalized: boolean;
}) {
  const requiredFields = React.useMemo(() => getRequiredFields(outputSchema), [outputSchema]);
  const fieldStatus = React.useMemo(
    () => checkRequiredFields(artifact, requiredFields),
    [artifact, requiredFields],
  );
  const fulfilledCount = [...fieldStatus.values()].filter(Boolean).length;
  const allFulfilled = requiredFields.length === 0 || fulfilledCount === requiredFields.length;

  return (
    <div className={cn(
      'flex h-full flex-col rounded-lg border transition-colors',
      finalized && 'border-green-300 dark:border-green-800',
    )}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Artifact</h3>
        {artifact && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            finalized
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
          )}>
            {finalized ? <Lock className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
            {finalized ? 'Finalized' : 'Draft'}
          </span>
        )}
      </div>

      {/* Requirements checklist */}
      {requiredFields.length > 0 && !finalized && (
        <div className="border-b px-4 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Required fields</span>
            <span className={cn(
              'text-xs font-mono',
              allFulfilled ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
            )}>
              {fulfilledCount}/{requiredFields.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {requiredFields.map((field) => {
              const present = fieldStatus.get(field) === true;
              return (
                <span
                  key={field}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                    present
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {present ? <Check className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
                  {field}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className={cn('flex-1 overflow-auto p-4', finalized && 'opacity-80')}>
        {artifact ? (
          <pre className="rounded-md bg-muted p-3 text-xs overflow-auto whitespace-pre-wrap break-words font-mono">
            {JSON.stringify(artifact, null, 2)}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No artifact yet. Start a conversation to build one.
          </div>
        )}
      </div>

      {!finalized && (
        <div className="border-t p-4">
          <button
            onClick={onFinalize}
            disabled={!artifact || !allFulfilled || finalizing}
            className={cn(
              'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
              artifact && allFulfilled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {finalizing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Finalizing...
              </span>
            ) : (
              'Finalize Artifact'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ConversationView
// ---------------------------------------------------------------------------

export function ConversationView({
  session: initialSession,
  instance,
  handle,
  stepDescription,
}: ConversationViewProps) {
  const [turns, setTurns] = React.useState<ConversationTurn[]>(initialSession.turns);
  const [artifact, setArtifact] = React.useState<Record<string, unknown> | null>(
    initialSession.artifact,
  );
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalized, setFinalized] = React.useState(initialSession.status === 'finalized');
  const [error, setError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  React.useEffect(() => {
    if (!finalized) {
      inputRef.current?.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = React.useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [turns, scrollToBottom]);

  const handleSend = React.useCallback(async () => {
    const message = input.trim();
    if (!message || sending || finalized) return;

    setInput('');
    setError(null);
    setSending(true);

    const humanTurn: ConversationTurn = {
      id: crypto.randomUUID(),
      role: 'human',
      content: message,
      timestamp: new Date().toISOString(),
      artifactDelta: null,
    };
    setTurns((prev) => [...prev, humanTurn]);

    try {
      const result = await sendMessage(initialSession.id, message);

      if (!result.success) {
        setError(result.error ?? 'Failed to send message');
        return;
      }

      const agentTurn: ConversationTurn = {
        id: result.turnId ?? crypto.randomUUID(),
        role: 'agent',
        content: result.agentText ?? '',
        timestamp: new Date().toISOString(),
        artifactDelta: result.artifact ?? null,
      };
      setTurns((prev) => [...prev, agentTurn]);

      if (result.artifact) {
        setArtifact(result.artifact);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, finalized, initialSession.id]);

  const handleFinalize = React.useCallback(async () => {
    if (!artifact || finalizing) return;

    setFinalizing(true);
    setError(null);

    try {
      const result = await finalizeSession(initialSession.id, artifact);

      if (!result.success) {
        setError(result.error ?? 'Failed to finalize');
        return;
      }

      setFinalized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize');
    } finally {
      setFinalizing(false);
    }
  }, [artifact, finalizing, initialSession.id]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const runHref = instance
    ? routes.workflowRun(handle, instance.definitionName, instance.id)
    : null;

  return (
    <div className="flex h-[calc(100vh-12rem)] gap-4">
      {/* Chat panel */}
      <div className="flex flex-1 flex-col rounded-lg border">
        {/* Context panel (foldable) */}
        <ContextPanel instance={instance} session={initialSession} handle={handle} />

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {/* Step description as first system message */}
          {stepDescription && (
            <StepDescriptionBubble description={stepDescription} />
          )}

          {turns.length === 0 && !stepDescription && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Send a message to start collaborating.
            </div>
          )}

          {turns.map((turn) => (
            <ChatBubble key={turn.id} turn={turn} />
          ))}

          {sending && turns.length > 0 && turns[turns.length - 1].role === 'human' && (
            <ThinkingIndicator />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Finalized banner with navigation */}
        {finalized && (
          <div className="mx-4 mb-2 rounded-md bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-green-800 dark:text-green-300">
                <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                Session finalized. Workflow has advanced to the next step.
              </div>
              {runHref && (
                <Link
                  href={runHref}
                  className="inline-flex items-center gap-1 rounded-md bg-green-200 dark:bg-green-800 px-2 py-1 text-xs font-medium text-green-800 dark:text-green-200 hover:bg-green-300 dark:hover:bg-green-700 transition-colors shrink-0"
                >
                  View run
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t p-4">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending || finalized}
              placeholder={finalized ? 'Session finalized' : 'Type a message... (Enter to send, Shift+Enter for newline)'}
              rows={1}
              className={cn(
                'flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending || finalized}
              className={cn(
                'rounded-md px-3 py-2 transition-colors',
                input.trim() && !sending && !finalized
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Artifact panel */}
      <div className="w-[400px] shrink-0">
        <ArtifactPanel
          artifact={artifact}
          outputSchema={initialSession.outputSchema}
          onFinalize={handleFinalize}
          finalizing={finalizing}
          finalized={finalized}
        />
      </div>
    </div>
  );
}
