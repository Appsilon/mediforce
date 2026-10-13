const SKILL_LOADING_RUNTIMES: ReadonlySet<string> = new Set(['claude-code-agent', 'opencode-agent']);

/** Skills reach only runtimes that load them; anything else gets them silently dropped. */
export function SkillRuntimeWarning({ runtimeId, subject }: { runtimeId?: string; subject: string }) {
  if (runtimeId === undefined || runtimeId === '' || SKILL_LOADING_RUNTIMES.has(runtimeId)) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      Skills are applied to Claude Code and OpenCode agents only. {subject}&apos;s runtime is{' '}
      <code className="font-mono">{runtimeId}</code>, so it will not receive them.
    </div>
  );
}
