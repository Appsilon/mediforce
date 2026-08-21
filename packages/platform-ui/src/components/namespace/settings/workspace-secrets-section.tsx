'use client';

import { NamespaceSecretsEditor } from '@/components/namespace/namespace-secrets-editor';

interface WorkspaceSecretsSectionProps {
  handle: string;
  userId: string;
}

export function WorkspaceSecretsSection({ handle, userId }: WorkspaceSecretsSectionProps) {
  return (
    <div className="mb-10 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace Secrets</h2>
      <div className="rounded-lg border bg-card px-4 py-5">
        <NamespaceSecretsEditor namespace={handle} userId={userId} />
      </div>
    </div>
  );
}
