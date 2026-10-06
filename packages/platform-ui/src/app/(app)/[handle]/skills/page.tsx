'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { BookOpen, Globe, Lock, Plus } from 'lucide-react';
import type { AgentDefinition, SkillSummary } from '@mediforce/platform-core';
import { ConceptPopover } from '@/components/ui/concept-intro';
import { SearchField } from '@/components/ui/search-field';
import { SkillHolders } from '@/components/skills/skill-holders';
import { routes } from '@/lib/routes';
import { formatBytes } from '@/lib/format';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { skillKey, useSkillHolders, useSkills } from '@/hooks/use-skills';

function SkillCard({
  skill,
  handle,
  holders,
}: {
  skill: SkillSummary;
  handle: string;
  holders: AgentDefinition[];
}) {
  const VisibilityIcon = skill.visibility === 'public' ? Globe : Lock;
  return (
    <div
      className="group rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col"
      data-testid="skill-card"
    >
      <Link href={routes.skill(handle, skill.namespace, skill.id)} className="px-4 py-4 flex items-start gap-3 flex-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-semibold text-base font-mono group-hover:text-primary transition-colors">{skill.name}</h3>
            {skill.namespace !== handle && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">@{skill.namespace}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{skill.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {skill.paths.length} {skill.paths.length === 1 ? 'file' : 'files'} · {formatBytes(skill.size)} · updated{' '}
            {formatDistanceToNow(new Date(skill.updatedAt), { addSuffix: true })}
          </p>
        </div>
      </Link>
      <div className="border-t border-border/50 px-4 py-2.5 flex items-start justify-between gap-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground shrink-0">
          <VisibilityIcon className="h-3.5 w-3.5" />
          {skill.visibility === 'public' ? 'Public' : 'Private'}
        </span>
        <span className="text-right text-muted-foreground">
          <SkillHolders holders={holders} handle={handle} />
        </span>
      </div>
    </div>
  );
}

function SkillGrid({ title, skills, handle, holders }: {
  title: string;
  skills: SkillSummary[];
  handle: string;
  holders: Map<string, AgentDefinition[]>;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
        <span className="ml-2 text-xs font-normal">({skills.length})</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills.map((skill) => (
          <SkillCard
            key={skillKey(skill.namespace, skill.id)}
            skill={skill}
            handle={handle}
            holders={holders.get(skillKey(skill.namespace, skill.id)) ?? []}
          />
        ))}
      </div>
    </section>
  );
}

export default function SkillsPage() {
  const { handle } = useParams<{ handle: string }>();
  const { role } = useNamespaceRole(handle);
  const skills = useSkills(handle);
  const holders = useSkillHolders();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = skills.data ?? [];
    if (needle === '') return all;
    return all.filter((skill) =>
      skill.name.includes(needle) || skill.description.toLowerCase().includes(needle) || skill.namespace.includes(needle));
  }, [skills.data, query]);
  const own = filtered.filter((skill) => skill.namespace === handle);
  const others = filtered.filter((skill) => skill.namespace !== handle);

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-headline font-semibold">Skills</h1>
            <ConceptPopover label="What is a skill?">
              <p>
                <strong>A skill is a Claude Code skill folder:</strong> a <code className="font-mono">SKILL.md</code>{' '}
                that names and describes it, plus any references, scripts or templates beside it.
              </p>
              <p>
                An agent that holds a skill gets it in every step and loads it when the skill&apos;s description fits
                the task. A private skill is visible to this workspace; a public one to every workspace.
              </p>
            </ConceptPopover>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Skills agents in @{handle} can hold.</p>
        </div>
        {role !== null && (
          <Link
            href={routes.skillNew(handle)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New skill
          </Link>
        )}
      </div>

      <SearchField value={query} onChange={setQuery} placeholder="Search skills..." className="mb-6" />

      {skills.isError && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {skills.error instanceof Error ? skills.error.message : 'Failed to load skills.'}
        </div>
      )}

      {skills.isPending ? (
        <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">Loading skills…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <BookOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {query.trim() === '' ? 'No skills yet. Create one or upload a skill folder with “New skill”.' : 'No skills match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {own.length > 0 && <SkillGrid title={`@${handle}`} skills={own} handle={handle} holders={holders} />}
          {others.length > 0 && (
            <SkillGrid title="Public, from other workspaces" skills={others} handle={handle} holders={holders} />
          )}
        </div>
      )}
    </div>
  );
}
