'use client';

import { useEffect, useState } from 'react';
import { Trash2, Upload, Check } from 'lucide-react';
import type { Namespace } from '@mediforce/platform-core';
import type { UpdateNamespaceInput } from '@mediforce/platform-api/contract';
import { WorkspaceAvatar } from '@/components/workspace-avatar';
import { getWorkspaceIcon } from '@/lib/workspace-icons';
import { fileToLogoDataUrl, LOGO_MAX_EDGE_PX, LogoTooLargeError } from '@/lib/logo-image';
import { readableForegroundTriple } from '@/lib/brand-color';

// Starting values shown in the color pickers when a workspace has no brand
// color set yet — the hex equivalents of the platform's default `--primary`
// (172 66% 32%, teal) and `--accent` (38 92% 50%, amber) tokens in globals.css,
// so "Save colors" without a change persists the current look.
const DEFAULT_PRIMARY_HEX = '#1c8779';
const DEFAULT_ACCENT_HEX = '#f59f0a';

/**
 * Preview chip for a picked brand color. The label colour is derived from the
 * swatch itself, so a light brand colour stays legible instead of showing white
 * text on near-white.
 */
function BrandSwatch({ color, label }: { color: string; label: string }) {
  const foreground = readableForegroundTriple(color);
  return (
    <span
      className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium"
      style={{
        backgroundColor: color,
        color: foreground !== null ? `hsl(${foreground})` : undefined,
      }}
    >
      {label}
    </span>
  );
}

interface WorkspaceBrandingCardProps {
  namespace: Namespace;
  /** Icon key currently picked in the section — drives the logo fallback. */
  iconKey: string;
  saving: boolean;
  onSave: (update: Omit<UpdateNamespaceInput, 'handle'>) => Promise<void>;
}

export function WorkspaceBrandingCard({
  namespace,
  iconKey,
  saving,
  onSave,
}: WorkspaceBrandingCardProps) {
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_HEX);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_HEX);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [brandSaved, setBrandSaved] = useState(false);

  useEffect(() => {
    setPrimaryColor(
      namespace.brandPrimaryColor !== undefined && namespace.brandPrimaryColor !== ''
        ? namespace.brandPrimaryColor
        : DEFAULT_PRIMARY_HEX,
    );
    setAccentColor(
      namespace.brandAccentColor !== undefined && namespace.brandAccentColor !== ''
        ? namespace.brandAccentColor
        : DEFAULT_ACCENT_HEX,
    );
  }, [namespace]);

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    setLogoError(null);
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('Please choose an image file.');
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await fileToLogoDataUrl(file);
    } catch (error) {
      setLogoError(
        error instanceof LogoTooLargeError ? error.message : 'Image could not be read.',
      );
      return;
    }
    try {
      await onSave({ logo: dataUrl });
    } catch {
      setLogoError('Failed to upload logo.');
    }
  }

  async function handleRemoveLogo() {
    setLogoError(null);
    try {
      await onSave({ logo: '' });
    } catch {
      setLogoError('Failed to remove logo.');
    }
  }

  async function handleSaveBrandColors() {
    try {
      await onSave({ brandPrimaryColor: primaryColor, brandAccentColor: accentColor });
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 2500);
    } catch {
      // Optimistic snapshot already restored by the hook.
    }
  }

  async function handleResetBrandColors() {
    setPrimaryColor(DEFAULT_PRIMARY_HEX);
    setAccentColor(DEFAULT_ACCENT_HEX);
    try {
      await onSave({ brandPrimaryColor: '', brandAccentColor: '' });
    } catch {
      // Optimistic snapshot already restored by the hook.
    }
  }

  const Icon = getWorkspaceIcon(iconKey);

  return (
    <div className="rounded-lg border bg-card px-4 py-5 space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Logo</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload an image to use instead of the icon. Shown in the sidebar, workspace header, and workspace picker.
        </p>
        <div className="mt-4 flex items-center gap-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
            <WorkspaceAvatar
              source={namespace.logo}
              alt="Workspace logo"
              className="h-full w-full object-cover"
              fallback={<Icon className="h-7 w-7 text-primary" />}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                <Upload className="h-3.5 w-3.5" />
                {saving ? 'Uploading…' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                  className="hidden"
                  onChange={handleLogoChange}
                  disabled={saving}
                />
              </label>
              {namespace.logo !== undefined && namespace.logo !== '' && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              PNG, JPG, SVG, WebP or GIF · large images are resized to{' '}
              {LOGO_MAX_EDGE_PX}px · animated GIFs use their first frame.
            </p>
            {logoError !== null && <p className="text-[11px] text-destructive">{logoError}</p>}
          </div>
        </div>
      </div>

      <div className="border-t" />

      <div>
        <h3 className="text-sm font-semibold">Brand colors</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Set the main and auxiliary colors used across the workspace.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="primaryColor" className="text-xs font-medium">Main color</label>
            <div className="flex items-center gap-2">
              <input
                id="primaryColor"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                disabled={saving}
                className="h-9 w-12 cursor-pointer rounded border bg-background p-1 disabled:opacity-50"
              />
              <span className="font-mono text-xs text-muted-foreground uppercase">{primaryColor}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="accentColor" className="text-xs font-medium">Auxiliary color</label>
            <div className="flex items-center gap-2">
              <input
                id="accentColor"
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                disabled={saving}
                className="h-9 w-12 cursor-pointer rounded border bg-background p-1 disabled:opacity-50"
              />
              <span className="font-mono text-xs text-muted-foreground uppercase">{accentColor}</span>
            </div>
          </div>
          {/* Live preview using the picked colors directly */}
          <div className="flex items-center gap-2">
            <BrandSwatch color={primaryColor} label="Main" />
            <BrandSwatch color={accentColor} label="Auxiliary" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveBrandColors}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save colors'}
          </button>
          <button
            type="button"
            onClick={handleResetBrandColors}
            disabled={saving}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
          >
            Reset to default
          </button>
          {brandSaved && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
