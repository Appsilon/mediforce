'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { Namespace } from '@mediforce/platform-core';
import type { UpdateNamespaceInput } from '@mediforce/platform-api/contract';
import { useUpdateNamespace } from '@/hooks/use-namespace-mutations';
import { WorkspaceBrandingCard } from './workspace-branding-card';
import { WorkspaceIconPicker } from './workspace-icon-picker';

const DEFAULT_ICON_KEY = 'Building2';

interface WorkspaceProfileSectionProps {
  handle: string;
  namespace: Namespace;
}

/**
 * Name, description, branding and icon of the workspace. All four cards share
 * one `useUpdateNamespace` mutation, so any save in flight disables the whole
 * section.
 */
export function WorkspaceProfileSection({ handle, namespace }: WorkspaceProfileSectionProps) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [iconKey, setIconKey] = useState(DEFAULT_ICON_KEY);
  const [profileSaved, setProfileSaved] = useState(false);

  const updateNamespace = useUpdateNamespace(handle);
  const saving = updateNamespace.isPending;

  // Initialise form fields from namespace once loaded
  useEffect(() => {
    setDisplayName(namespace.displayName);
    setBio(namespace.bio ?? '');
    setIconKey(namespace.icon ?? DEFAULT_ICON_KEY);
  }, [namespace]);

  async function save(update: Omit<UpdateNamespaceInput, 'handle'>) {
    await updateNamespace.mutateAsync({ handle, ...update });
  }

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (trimmedName === '') return;
    const trimmedBio = bio.trim();
    try {
      await save({ displayName: trimmedName, bio: trimmedBio });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch {
      // Optimistic snapshot already restored by the hook; nothing to do.
    }
  }

  async function handleIconChange(nextIconKey: string) {
    setIconKey(nextIconKey);
    try {
      await save({ icon: nextIconKey });
    } catch {
      setIconKey(namespace.icon ?? DEFAULT_ICON_KEY);
    }
  }

  return (
    <div className="mb-10 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile</h2>

      {/* Name + bio form */}
      <div className="rounded-lg border bg-card px-4 py-5">
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="workspaceName" className="text-sm font-medium">
              Workspace name
            </label>
            <input
              id="workspaceName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My workspace"
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              disabled={saving}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="workspaceBio" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="workspaceBio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What is this workspace used for?"
              rows={3}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
              disabled={saving}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || displayName.trim() === ''}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {profileSaved && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
          </div>
        </form>
      </div>

      {namespace.type === 'organization' && (
        <>
          <WorkspaceBrandingCard
            namespace={namespace}
            iconKey={iconKey}
            saving={saving}
            onSave={save}
          />
          <WorkspaceIconPicker iconKey={iconKey} onSelect={handleIconChange} />
        </>
      )}
    </div>
  );
}
