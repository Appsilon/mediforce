'use client';

import { useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import {
  DEFAULT_JOIN_LINK_EXPIRY_DAYS,
  MAX_JOIN_LINK_EXPIRY_DAYS,
} from '@mediforce/platform-api/contract';
import type { CreateJoinLinkOutput, JoinLinkView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { useJoinLinks } from '@/hooks/use-join-links';

/**
 * Join links in workspace settings (ADR-0021 §2) — the "onboard a room" half of
 * Members, beside the one-address-at-a-time **Invite user**.
 *
 * Organizations only: a personal workspace is one person's own space, and the
 * caller does not render this there.
 *
 * The minted URL is shown once and then never again — only its hash is stored —
 * so the freshly created link gets a persistent card with a copy button rather
 * than a toast that can be missed.
 */
export function JoinLinksPanel({
  handle,
  canManageMembers,
}: {
  handle: string;
  canManageMembers: boolean;
}) {
  const { links, loading, error: listError, refresh } = useJoinLinks(handle, canManageMembers);

  const [showForm, setShowForm] = useState(false);
  const [membership, setMembership] = useState<'member' | 'admin'>('member');
  const [expiresInDays, setExpiresInDays] = useState(String(DEFAULT_JOIN_LINK_EXPIRY_DAYS));
  const [maxUses, setMaxUses] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<CreateJoinLinkOutput | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canManageMembers) return null;

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const parsedMaxUses = maxUses.trim() === '' ? undefined : Number.parseInt(maxUses, 10);
      const result = await mediforce.joinLinks.create({
        namespaceHandle: handle,
        membership,
        expiresInDays: Number.parseInt(expiresInDays, 10),
        ...(parsedMaxUses !== undefined ? { maxUses: parsedMaxUses } : {}),
      });
      setMinted(result);
      setCopied(false);
      setShowForm(false);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create join link.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await mediforce.joinLinks.revoke({ namespaceHandle: handle, id });
      // A revoked link's URL is worthless; drop the card so nobody copies it.
      if (minted?.link.id === id) setMinted(null);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke join link.');
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the URL is selectable in the field
      // beside the button, so there is nothing to recover from.
      setCopied(false);
    }
  }

  return (
    <div className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Join links
        </h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => { setError(null); setShowForm(true); }}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Create join link
          </button>
        )}
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        Anyone with the link can join this workspace by entering their email. They are sent a
        sign-in link — the join link never signs anybody in on its own, so it is safe on a slide.
      </p>

      {minted !== null && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-4">
          <div className="flex items-start gap-2">
            <Link2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Join link created — copy it now
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={minted.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(minted.url)}
                  className="flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300">
                Only a hash is stored, so this link cannot be shown again. Lost it? Create another
                and revoke this one.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMinted(null)}
              className="text-green-500 hover:text-green-700 transition-colors text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p className="mb-3 text-xs text-destructive">{error}</p>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-4 flex flex-col gap-3 rounded-lg border bg-card px-4 py-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="joinLinkMembership" className="text-sm font-medium">Joins as</label>
            <select
              id="joinLinkMembership"
              value={membership}
              onChange={(e) => setMembership(e.target.value as 'member' | 'admin')}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              disabled={creating}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="joinLinkExpiry" className="text-sm font-medium">Expires in (days)</label>
            <input
              id="joinLinkExpiry"
              type="number"
              min={1}
              max={MAX_JOIN_LINK_EXPIRY_DAYS}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              disabled={creating}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="joinLinkMaxUses" className="text-sm font-medium">
              Max uses <span className="text-muted-foreground">(blank = no limit)</span>
            </label>
            <input
              id="joinLinkMaxUses"
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="e.g. 30"
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              disabled={creating}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={creating}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating…' : 'Create link'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : listError !== null ? (
        // "No join links yet" and "we could not read them" are opposite facts
        // that would otherwise render identically — an admin must not conclude
        // a workshop link was never created because the read failed.
        <p className="text-sm text-destructive">Could not load join links: {listError.message}</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No join links yet.</p>
      ) : (
        <JoinLinksTable links={links} onRevoke={handleRevoke} />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<JoinLinkView['status'], string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  exhausted: 'Fully used',
};

function JoinLinksTable({
  links,
  onRevoke,
}: {
  links: JoinLinkView[];
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Joins as</th>
            <th className="px-4 py-2 font-medium">Used</th>
            <th className="px-4 py-2 font-medium">Expires</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr key={link.id} className="border-b last:border-b-0">
              <td className="px-4 py-2">{STATUS_LABEL[link.status]}</td>
              <td className="px-4 py-2">{link.membership}</td>
              <td className="px-4 py-2">
                {link.maxUses === null ? link.uses : `${link.uses} / ${link.maxUses}`}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(link.expiresAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-2 text-right">
                {/* Only a live link can be revoked; an expired or spent one is
                    already closed, and revoking it would say nothing. */}
                {link.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => onRevoke(link.id)}
                    className="text-xs font-medium text-destructive hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
