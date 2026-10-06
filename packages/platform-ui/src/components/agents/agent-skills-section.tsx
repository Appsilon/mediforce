'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { AgentSkillRef, AgentVisibility, SkillSummary } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';

const CLAUDE_CODE_RUNTIME = 'claude-code-agent';

interface AgentSkillsSectionProps {
  /** The agent's workspace, whose Skills are listed first. A built-in agent
   *  has none; pass the current workspace, and only public Skills show. */
  namespace: string;
  /** `false` for a built-in agent, which has no workspace of its own. */
  ownsNamespace: boolean;
  visibility: AgentVisibility;
  selected: AgentSkillRef[];
  onChange: (next: AgentSkillRef[]) => void;
  runtimeId?: string;
}

interface SkillOption {
  ref: AgentSkillRef;
  description: string | null;
}

const refKey = (ref: AgentSkillRef) => `${ref.namespace}/${ref.id}`;

/**
 * The Skills an agent may hold (ADR-0025 decision 3): a private agent its own
 * workspace's and every public one, a public agent public ones only. A held
 * Skill outside that set (deleted, made private, or the agent made public)
 * still shows so it can be unticked.
 */
export function AgentSkillsSection({ namespace, ownsNamespace, visibility, selected, onChange, runtimeId }: AgentSkillsSectionProps) {
  const [available, setAvailable] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mediforce.skills
      .list({ namespace, includePublic: true })
      .then((result) => {
        if (cancelled === false) setAvailable(result.skills);
      })
      .catch((err: unknown) => {
        if (cancelled === false) setError(err instanceof Error ? err.message : 'Failed to load skills.');
      })
      .finally(() => {
        if (cancelled === false) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  const selectedKeys = new Set(selected.map(refKey));
  const mayHold = available.filter((skill) =>
    skill.visibility === 'public' || (visibility === 'private' && ownsNamespace && skill.namespace === namespace));
  const mayHoldKeys = new Set(mayHold.map(refKey));
  const options: SkillOption[] = [
    ...mayHold.map((skill) => ({ ref: { namespace: skill.namespace, id: skill.id }, description: skill.description })),
    ...selected.filter((ref) => mayHoldKeys.has(refKey(ref)) === false).map((ref) => ({ ref, description: null })),
  ];

  function toggle(ref: AgentSkillRef) {
    const key = refKey(ref);
    if (selectedKeys.has(key)) {
      onChange(selected.filter((held) => refKey(held) !== key));
      return;
    }
    // Skill ids are plugin directory names, so a second namespace's skill with
    // the same id replaces the held one instead of being added beside it.
    onChange([...selected.filter((held) => held.id !== ref.id), ref]);
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card px-4 py-4" data-testid="agent-skills-section">
      <header className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Skills</h2>
      </header>

      <p className="text-xs text-muted-foreground">
        Claude Code skills offered to this agent in every step. It loads one when the skill&apos;s description fits
        the task.
      </p>

      {runtimeId !== undefined && runtimeId !== CLAUDE_CODE_RUNTIME && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Skills are applied to Claude Code agents only. This agent&apos;s runtime is{' '}
          <code className="font-mono">{runtimeId}</code>, so it will not receive them.
        </div>
      )}

      {error !== null && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground animate-pulse">
          Loading…
        </div>
      ) : options.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-center">
          <p className="text-sm font-medium">No skills available.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one with <code className="font-mono">mediforce skill create --from &lt;dir&gt;</code>.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {options.map(({ ref, description }) => {
            const key = refKey(ref);
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedKeys.has(key)}
                    onChange={() => toggle(ref)}
                    aria-label={`Skill ${key}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-medium">{ref.id}</span>
                      {(ownsNamespace === false || ref.namespace !== namespace) && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {ref.namespace}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                      {description ?? 'This agent may not hold this skill. Untick it to save.'}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
