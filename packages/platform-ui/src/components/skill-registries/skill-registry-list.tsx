'use client';

import { cn } from '@/lib/utils';
import { GitBranch } from 'lucide-react';
import type { SkillRegistry } from '@mediforce/platform-core';

interface SkillRegistryListProps {
  registries: SkillRegistry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function truncateUrl(url: string, max = 40): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}

function shortSha(commit: string | undefined): string {
  if (commit === undefined || commit === '') return '—';
  return commit.slice(0, 7);
}

export function SkillRegistryList({ registries, selectedId, onSelect }: SkillRegistryListProps) {
  if (registries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <GitBranch className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No skill registries yet.</p>
        <p className="text-xs text-muted-foreground">
          Add a git repo containing skills to make them available to agents.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {registries.map((registry) => {
        const isSelected = registry.id === selectedId;
        return (
          <li key={registry.id}>
            <button
              type="button"
              onClick={() => onSelect(registry.id)}
              className={cn(
                'w-full px-4 py-3 text-left transition-colors hover:bg-muted/40',
                isSelected && 'bg-muted',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{registry.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{registry.id}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground font-mono">
                {truncateUrl(registry.repo.url)}
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-mono">{shortSha(registry.repo.commit)}</span>
                <span className="font-mono">{registry.skillsDir}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
