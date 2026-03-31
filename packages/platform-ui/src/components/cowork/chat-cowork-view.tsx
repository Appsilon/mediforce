'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Send, Loader2, Bot, User, CheckCircle, AlertCircle,
  Info, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sendMessage, finalizeSession } from '@/app/actions/cowork';
import { routes } from '@/lib/routes';
import type { CoworkSession, ConversationTurn, ProcessInstance } from '@mediforce/platform-core';
import { ArtifactPanel } from './artifact-panel';
import { ContextPanel } from './context-panel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatCoworkViewProps {
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
// Main ChatCoworkView
// ---------------------------------------------------------------------------

export function ChatCoworkView({
  session: initialSession,
  instance,
  handle,
  stepDescription,
}: ChatCoworkViewProps) {
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
