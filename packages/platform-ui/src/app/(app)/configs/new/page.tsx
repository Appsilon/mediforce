'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useProcessConfig } from '@/hooks/use-process-config';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { ConfigEditor } from '@/components/configs/config-editor';
import type { StepConfig } from '@mediforce/platform-core';

function NewConfigContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const processName = searchParams.get('process') ?? '';
  const cloneConfig = searchParams.get('cloneConfig');
  const cloneVersion = searchParams.get('cloneVersion');

  const isClone = Boolean(cloneConfig && cloneVersion);

  const { data: sourceConfig, loading: sourceLoading } = useProcessConfig(
    isClone ? processName : null,
    cloneConfig,
    cloneVersion,
  );
  const { versions, loading: defLoading } =
    useProcessDefinitionVersions(processName);

  const latestDefinition = versions[0] ?? null;
  const loading = defLoading || (isClone && sourceLoading);

  const handleSaved = (configName: string, configVersion: string) => {
    router.push(
      `/configs/${encodeURIComponent(processName)}/${encodeURIComponent(configName)}/${encodeURIComponent(configVersion)}`,
    );
  };

  if (!processName) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Missing process name. Navigate from a process detail page.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-5 w-64 rounded bg-muted animate-pulse" />
        <div className="h-8 w-48 rounded bg-muted animate-pulse" />
        <div className="flex gap-6">
          <div className="w-64 shrink-0 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 rounded bg-muted animate-pulse" />
            ))}
          </div>
          <div className="flex-1 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!latestDefinition) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Process definition not found for "{processName}"
        </p>
      </div>
    );
  }

  // Build initialConfig: clone from source or undefined (editor handles defaults)
  const initialConfig =
    isClone && sourceConfig
      ? {
          processName,
          configName: sourceConfig.configName,
          configVersion: sourceConfig.configVersion,
          stepConfigs: sourceConfig.stepConfigs as StepConfig[],
        }
      : undefined;

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/workflows"
          className="hover:text-foreground transition-colors"
        >
          Processes
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          href={`/workflows/${encodeURIComponent(processName)}`}
          className="hover:text-foreground transition-colors"
        >
          {processName}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">New Configuration</span>
      </nav>

      <h1 className="text-xl font-headline font-semibold">
        {isClone ? 'Clone Configuration' : 'New Configuration'}
      </h1>
      {isClone && sourceConfig && (
        <p className="text-sm text-muted-foreground">
          Based on {sourceConfig.configName} v{sourceConfig.configVersion}
        </p>
      )}

      <ConfigEditor
        processName={processName}
        definition={latestDefinition}
        initialConfig={initialConfig}
        readOnly={false}
        onSaved={handleSaved}
      />
    </div>
  );
}

export default function NewConfigPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 space-y-4">
          <div className="h-5 w-64 rounded bg-muted animate-pulse" />
          <div className="h-8 w-48 rounded bg-muted animate-pulse" />
        </div>
      }
    >
      <NewConfigContent />
    </Suspense>
  );
}
