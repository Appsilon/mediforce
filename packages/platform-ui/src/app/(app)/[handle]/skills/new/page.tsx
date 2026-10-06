'use client';

import { useParams } from 'next/navigation';
import { SkillEditor } from '@/components/skills/skill-editor';
import { useNamespaceRole } from '@/hooks/use-namespace-role';

export default function NewSkillPage() {
  const { handle } = useParams<{ handle: string }>();
  const { role, loading } = useNamespaceRole(handle);
  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">Loading…</div>;
  }
  if (role === null) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Only members of @{handle} can create its skills.
        </div>
      </div>
    );
  }
  return <SkillEditor handle={handle} skill={null} readOnly={false} holders={[]} />;
}
