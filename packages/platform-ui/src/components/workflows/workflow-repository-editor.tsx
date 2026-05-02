'use client';

import * as React from 'react';
import { GitBranch, Save, Info, ExternalLink } from 'lucide-react';
import { saveWorkflowRepository } from '@/app/actions/definitions';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';

interface WorkflowRepositoryEditorProps {
  namespace: string;
  workflowName: string;
  userId: string;
  initialRemote?: string;
  initialRemoteAuth?: string;
  /** Latest WD version — shown as the source of these settings, bumped on save. */
  latestVersion: number;
}

/** Translate "org/repo" / SSH URL / HTTPS URL into a browsable https://github.com/... link. */
function toBrowsableUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('https://')) return trimmed.replace(/\.git$/, '');
  const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
  return null;
}

function isValidRemote(remote: string): boolean {
  const trimmed = remote.trim();
  if (trimmed === '') return true; // empty = local-only, valid
  if (trimmed.startsWith('https://') || trimmed.startsWith('git@')) return true;
  return /^[\w.-]+\/[\w.-]+$/.test(trimmed);
}

export function WorkflowRepositoryEditor({
  namespace,
  workflowName,
  userId,
  initialRemote,
  initialRemoteAuth,
  latestVersion,
}: WorkflowRepositoryEditorProps) {
  const [remote, setRemote] = React.useState(initialRemote ?? '');
  const [remoteAuth, setRemoteAuth] = React.useState(initialRemoteAuth ?? '');
  const [secretKeys, setSecretKeys] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [savedVersion, setSavedVersion] = React.useState<number>(latestVersion);

  const initialRemoteRef = React.useRef(initialRemote ?? '');
  const initialAuthRef = React.useRef(initialRemoteAuth ?? '');
  const dirty = remote !== initialRemoteRef.current || remoteAuth !== initialAuthRef.current;
  const remoteValid = isValidRemote(remote);
  const browsable = toBrowsableUrl(remote);

  React.useEffect(() => {
    let cancelled = false;
    getWorkflowSecretKeys(namespace, workflowName, userId)
      .then((keys) => { if (!cancelled) setSecretKeys(keys); })
      .catch((err) => { if (!cancelled) console.error('Failed to load secret keys:', err); });
    return () => { cancelled = true; };
  }, [namespace, workflowName, userId]);

  const handleSave = async () => {
    if (!remoteValid) {
      setMessage('Error: invalid remote format');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveWorkflowRepository(workflowName, {
        remote: remote || undefined,
        remoteAuth: remoteAuth || undefined,
      });
      if (result.success) {
        initialRemoteRef.current = remote;
        initialAuthRef.current = remoteAuth;
        setSavedVersion(result.version);
        setMessage(`Saved as version ${result.version}`);
        setTimeout(() => setMessage(null), 4000);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessage(`Error: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3 text-sm text-blue-800 dark:text-blue-300">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          A run-scoped git workspace is shared across all steps. When a remote is set,
          the bare repo mirrors it on the host (<code className="rounded bg-blue-100 dark:bg-blue-900/50 px-1 py-0.5 font-mono text-xs">git fetch</code> at run start).
          Run branches stay local — pushes are not enabled yet. Saving updates the workflow definition (new version).
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="workspace-remote" className="block text-xs font-medium text-muted-foreground mb-1">
            Remote
          </label>
          <div className="relative">
            <GitBranch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              id="workspace-remote"
              type="text"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              placeholder="org/repo  or  git@github.com:org/repo.git  (leave empty for local-only)"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm font-mono"
            />
          </div>
          {!remoteValid && remote.trim() !== '' && (
            <p className="text-xs text-destructive mt-1">
              Expected <code className="font-mono">org/repo</code>, an SSH URL, or an HTTPS URL.
            </p>
          )}
          {browsable && remoteValid && (
            <a
              href={browsable}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              <ExternalLink className="h-3 w-3" />
              {browsable}
            </a>
          )}
        </div>

        <div>
          <label htmlFor="workspace-remote-auth" className="block text-xs font-medium text-muted-foreground mb-1">
            Auth (workflow secret name)
          </label>
          <select
            id="workspace-remote-auth"
            value={remoteAuth}
            onChange={(e) => setRemoteAuth(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
          >
            <option value="">— SSH deploy key (default) —</option>
            {secretKeys.map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
            {remoteAuth && !secretKeys.includes(remoteAuth) && (
              <option value={remoteAuth}>{remoteAuth} (not in secrets)</option>
            )}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Secret value is used as a GitHub PAT for HTTPS clone. Leave empty to authenticate with the host SSH deploy key.
          </p>
          {remoteAuth && !secretKeys.includes(remoteAuth) && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Warning: <code className="font-mono">{remoteAuth}</code> is not defined in this workflow&apos;s secrets.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
        <span>Source: workflow definition <span className="font-mono">v{savedVersion}</span></span>
        {dirty && <span className="text-amber-600 dark:text-amber-400">unsaved changes</span>}
        <div className="flex-1" />
        {message && (
          <span className={message.startsWith('Error:') ? 'text-destructive' : 'text-green-600 dark:text-green-400'}>
            {message}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty || !remoteValid}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save (new version)'}
        </button>
      </div>
    </div>
  );
}
