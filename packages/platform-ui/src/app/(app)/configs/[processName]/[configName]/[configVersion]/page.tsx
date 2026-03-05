'use client';

import { use } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useProcessConfig } from '@/hooks/use-process-config';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { ConfigEditor } from '@/components/configs/config-editor';

interface ConfigViewPageProps {
  params: Promise<{
    processName: string;
    configName: string;
    configVersion: string;
  }>;
}

export default function ConfigViewPage({ params }: ConfigViewPageProps) {
  const { processName, configName, configVersion } = use(params);

  const decodedProcess = decodeURIComponent(processName);
  const decodedConfigName = decodeURIComponent(configName);
  const decodedConfigVersion = decodeURIComponent(configVersion);

  const { data: config, loading: configLoading } = useProcessConfig(
    decodedProcess,
    decodedConfigName,
    decodedConfigVersion,
  );
  const { versions, loading: defLoading } =
    useProcessDefinitionVersions(decodedProcess);

  const loading = configLoading || defLoading;
  const latestDefinition = versions[0] ?? null;

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

  if (!config) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Config not found</p>
      </div>
    );
  }

  if (!latestDefinition) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Process definition not found for "{decodedProcess}"
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/processes" className="hover:text-foreground transition-colors">
          Processes
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          href={`/processes/${encodeURIComponent(decodedProcess)}`}
          className="hover:text-foreground transition-colors"
        >
          {decodedProcess}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span>Configurations</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">
          {decodedConfigName} v{decodedConfigVersion}
        </span>
      </nav>

      <h1 className="text-xl font-headline font-semibold">
        {decodedConfigName}{' '}
        <span className="font-mono text-base text-muted-foreground">
          v{decodedConfigVersion}
        </span>
      </h1>

      <ConfigEditor
        processName={decodedProcess}
        definition={latestDefinition}
        initialConfig={{
          processName: decodedProcess,
          configName: decodedConfigName,
          configVersion: decodedConfigVersion,
          stepConfigs: config.stepConfigs as any,
        }}
        readOnly
      />
    </div>
  );
}
