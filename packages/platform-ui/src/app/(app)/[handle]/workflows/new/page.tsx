'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { YamlEditor } from '@/components/processes/yaml-editor';

export default function NewProcessPage() {
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();
  const [namespace, setNamespace] = React.useState('');

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 max-w-3xl">
      <div>
        <p className="text-sm text-muted-foreground">
          Paste a YAML workflow definition. It will be validated and saved to the platform.
        </p>
      </div>

      <YamlEditor
        namespace={namespace}
        onNamespaceChange={setNamespace}
        onSaved={(name) => router.push(`/${handle}/workflows/${encodeURIComponent(name)}`)}
      />
    </div>
  );
}
