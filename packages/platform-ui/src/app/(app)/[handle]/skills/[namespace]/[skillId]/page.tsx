'use client';

import { useParams } from 'next/navigation';
import { SkillEditor } from '@/components/skills/skill-editor';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { skillKey, useSkill, useSkillHolders } from '@/hooks/use-skills';

export default function SkillPage() {
  const params = useParams<{ handle: string; namespace: string; skillId: string }>();
  const namespace = decodeURIComponent(params.namespace);
  const skillId = decodeURIComponent(params.skillId);
  const { role, loading: roleLoading } = useNamespaceRole(namespace);
  const skill = useSkill(namespace, skillId);
  const holders = useSkillHolders();

  if (skill.isError) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {skill.error instanceof Error ? skill.error.message : 'Failed to load the skill.'}
        </div>
      </div>
    );
  }
  if (skill.data === undefined || roleLoading) {
    return <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">Loading skill…</div>;
  }
  return (
    <SkillEditor
      // A new editor per Skill: its draft is seeded once, from the Skill it opens.
      key={skillKey(namespace, skillId)}
      handle={params.handle}
      skill={skill.data}
      // Writes need workspace write on the Skill's own workspace (ADR-0025 §8).
      readOnly={role === null}
      holders={holders.get(skillKey(namespace, skillId)) ?? []}
    />
  );
}
