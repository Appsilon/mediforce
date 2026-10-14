'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { mayHoldSkill, type AgentSkillRef, type WorkflowVisibility } from '@mediforce/platform-core';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { skillKey, useSkills } from '@/hooks/use-skills';
import { SkillRuntimeWarning } from '@/components/skills/skill-runtime-warning';
import { selectBase } from './step-editor-fields';

const refKey = (ref: AgentSkillRef) => skillKey(ref.namespace, ref.id);

/**
 * The catalog Skills offered to a step (ADR-0027): its agent's,
 * shown but not removable here, and the ones the step adds on top. The step
 * may add what its workflow may hold — a private workflow its workspace's
 * Skills and every public one, a public workflow public ones only. An agent
 * Skill the step adds one of the same id for is shown as replaced.
 */
export function StepSkillsField({
  namespace,
  workflowVisibility,
  runtimeId,
  agentName,
  agentSkills,
  selected,
  onChange,
}: {
  namespace: string;
  workflowVisibility: WorkflowVisibility;
  /** The step's plugin: a runtime that does not load Skills gets a warning. */
  runtimeId?: string;
  agentName?: string;
  agentSkills: AgentSkillRef[];
  selected: AgentSkillRef[];
  onChange: (next: AgentSkillRef[]) => void;
}) {
  const skills = useSkills(namespace);
  const taken = new Set([...agentSkills, ...selected].map(refKey));
  const replacedIds = new Set(selected.map((ref) => ref.id));
  const workflow = { namespace, visibility: workflowVisibility };
  const addable = (skills.data ?? []).filter((skill) =>
    taken.has(refKey(skill)) === false && mayHoldSkill(workflow, skill));

  function add(key: string) {
    const skill = addable.find((candidate) => refKey(candidate) === key);
    if (skill === undefined) return;
    // Skill ids are plugin directory names: a second workspace's skill with
    // the same id replaces the one already added.
    onChange([...selected.filter((ref) => ref.id !== skill.id), { namespace: skill.namespace, id: skill.id }]);
  }

  const chip = (ref: AgentSkillRef, removable: boolean, replaced = false) => (
    <span
      key={refKey(ref)}
      title={replaced ? 'Replaced by the step\'s skill of the same name' : undefined}
      className={cn('inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs', replaced && 'opacity-60')}
    >
      <span className={cn('font-mono', replaced && 'line-through')}>{ref.id}</span>
      {replaced && <span className="text-[10px] text-muted-foreground">replaced</span>}
      {ref.namespace !== namespace && <span className="text-[10px] text-muted-foreground">{ref.namespace}</span>}
      {removable && (
        <button
          type="button"
          aria-label={`Remove skill ${refKey(ref)}`}
          onClick={() => onChange(selected.filter((held) => refKey(held) !== refKey(ref)))}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  return (
    <div className="space-y-2">
      {agentSkills.length + selected.length > 0 && <SkillRuntimeWarning runtimeId={runtimeId} subject="This step" />}
      {agentSkills.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">from {agentName ?? 'the agent'}</p>
          <div className="flex flex-wrap gap-1.5">{agentSkills.map((ref) => chip(ref, false, replacedIds.has(ref.id)))}</div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">from step definition</p>
          <div className="flex flex-wrap gap-1.5">{selected.map((ref) => chip(ref, true))}</div>
        </div>
      )}
      <select aria-label="Add skill" value="" onChange={(e) => add(e.target.value)} className={selectBase}>
        <option value="">
          {skills.isPending ? 'Loading skills…' : addable.length === 0 ? 'No more skills to add' : 'Add a skill…'}
        </option>
        {addable.map((skill) => (
          <option key={refKey(skill)} value={refKey(skill)}>
            {skill.id}{skill.namespace === namespace ? '' : ` (${skill.namespace})`} — {skill.description}
          </option>
        ))}
      </select>
      {skills.isError && <p className="text-xs text-amber-600">Skill list unavailable.</p>}
      <p className="text-[11px] text-muted-foreground">
        Manage skills on the{' '}
        <Link href={routes.skills(namespace)} className="underline">Skills</Link> page.
      </p>
    </div>
  );
}
