'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { YamlEditor } from '@/components/processes/yaml-editor';

export default function NewProcessPage() {
  const router = useRouter();

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 max-w-3xl">
      <div>
        <Link
          href="/processes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Workflows
        </Link>
        <h1 className="text-xl font-headline font-semibold">New Workflow</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Paste a YAML workflow definition. It will be validated and saved to the platform.
        </p>
      </div>

      <YamlEditor
        onSaved={(name) => router.push(`/processes/${encodeURIComponent(name)}`)}
      />
    </div>
  );
}
