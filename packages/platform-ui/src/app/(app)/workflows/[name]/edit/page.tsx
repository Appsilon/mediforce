'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowEditor } from '@/components/workflows/workflow-editor';

export default function WorkflowEditPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);

  const { definitions, loading } = useWorkflowDefinitions(decodedName);
  const latest = definitions[0] ?? null;

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-96 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0">
      <div className="border-b px-6 py-4">
        <Link
          href={`/workflows/${name}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {decodedName}
        </Link>
        <h1 className="text-xl font-headline font-semibold">
          Edit workflow{latest ? ` (based on v${latest.version})` : ''}
        </h1>
      </div>

      <div className="flex-1 p-6 max-w-3xl">
        <WorkflowEditor
          workflowName={decodedName}
          initialDefinition={latest ?? undefined}
          onSaved={(savedName, version) => {
            router.push(`/workflows/${encodeURIComponent(savedName)}/definitions/${version}`);
          }}
        />
      </div>
    </div>
  );
}
