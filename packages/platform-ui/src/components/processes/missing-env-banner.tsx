'use client';

import * as React from 'react';
import { KeyRound, Play } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { saveWorkflowSecrets, getWorkflowSecrets } from '@/app/actions/workflow-secrets';
import { resumeProcessRun } from '@/app/actions/processes';

interface MissingEnvVar {
  secretName: string;
  template: string;
  steps: Array<{ stepId: string; stepName: string }>;
}

export function MissingEnvBanner({
  instanceId,
  errorJson,
  workflowName,
}: {
  instanceId: string;
  errorJson: string;
  workflowName: string;
}) {
  const { firebaseUser } = useAuth();
  const handle = useHandleFromPath();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const missing = React.useMemo<MissingEnvVar[]>(() => {
    try {
      const parsed = JSON.parse(errorJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [errorJson]);

  if (missing.length === 0) return null;

  const allFilled = missing.every((m) => values[m.secretName]?.trim());

  async function handleSaveAndResume() {
    if (!firebaseUser || !handle) return;
    setSaving(true);
    setStatus(null);
    try {
      // Merge new values with existing secrets (preserve what's already set)
      const existing = await getWorkflowSecrets(handle, workflowName, firebaseUser.uid);
      const merged = { ...existing };
      for (const m of missing) {
        const val = values[m.secretName]?.trim();
        if (val) merged[m.secretName] = val;
      }
      await saveWorkflowSecrets(handle, workflowName, merged, firebaseUser.uid);

      const result = await resumeProcessRun(instanceId);
      if (!result.success) {
        setStatus(result.error ?? 'Resume failed');
      }
      // Page will refresh via instance polling — no manual reload needed
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <KeyRound className="h-4 w-4" />
        Missing environment variables
      </div>
      <p className="text-sm text-amber-700 dark:text-amber-400">
        This workflow needs secrets that aren&apos;t configured yet. Set them below to continue:
      </p>
      <div className="space-y-2">
        {missing.map((m) => (
          <div key={m.secretName} className="space-y-1">
            <div className="flex items-center gap-3">
              <label className="font-mono text-xs text-amber-800 dark:text-amber-300 w-52 shrink-0 truncate" title={m.secretName}>
                {m.secretName}
              </label>
              <input
                type="password"
                value={values[m.secretName] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [m.secretName]: e.target.value }))}
                placeholder={`Enter ${m.secretName}`}
                className="flex-1 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-amber-950/30 px-2.5 py-1.5 text-sm font-mono placeholder:text-amber-400 dark:placeholder:text-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-500 pl-[13.5rem]">
              Used by: {m.steps.map((s) => s.stepName).join(', ')}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSaveAndResume}
          disabled={saving || !allFilled}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Play className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save & Resume'}
        </button>
        {status && <span className="text-xs text-red-600 dark:text-red-400">{status}</span>}
      </div>
    </div>
  );
}
