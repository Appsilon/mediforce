'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  JoinLinkRejectionSchema,
  PreviewJoinLinkOutputSchema,
  RedeemJoinLinkOutputSchema,
} from '@mediforce/platform-api/contract';
import type {
  PreviewJoinLinkOutput,
  RedeemJoinLinkOutput,
} from '@mediforce/platform-api/contract';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api-fetch';

type Rejection = z.infer<typeof JoinLinkRejectionSchema>;

/**
 * The whole join flow: resolve what the link opens, collect an email, redeem.
 *
 * Submitting does NOT sign anybody in (ADR-0021 §4). It seeds the account and
 * sends the same activation email an admin invite sends, which is why the
 * success state talks about checking a mailbox rather than showing a workspace.
 *
 * `apiFetch` rather than `mediforce.*`: both endpoints are public by design and
 * have no client method — a credentialed client has no business calling them.
 */
export function JoinFlow({ token }: { token: string }) {
  const [preview, setPreview] = useState<PreviewJoinLinkOutput | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch('/api/join/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          // A rejected token is an expected answer here, not an incident — the
          // global error reporter would otherwise flag every stale link.
          reportErrors: false,
        });
        // Parsed, not cast: this is untrusted wire data on a page anyone can
        // open, and the contract schema is what says what shape it must be.
        const parsed = PreviewJoinLinkOutputSchema.safeParse(
          await response.json().catch(() => null),
        );
        if (cancelled) return;
        if (!response.ok || !parsed.success) {
          setPreviewFailed(true);
          return;
        }
        setPreview(parsed.data);
      } catch {
        if (!cancelled) setPreviewFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (previewFailed) {
    return (
      <Notice
        title="Could not check this join link"
        body="Something went wrong on our side. Reload the page, or ask whoever shared the link for a new one."
      />
    );
  }

  if (preview === null) {
    return <p className="text-sm text-muted-foreground">Checking your link…</p>;
  }

  if (!preview.ok) {
    const copy = REASON_COPY[preview.reason];
    return <Notice title={copy.title} body={copy.body} showSignIn />;
  }

  return (
    <JoinForm token={token} workspaceName={preview.workspaceName} />
  );
}

const REASON_COPY: Record<Rejection, { title: string; body: string }> = {
  not_found: {
    title: 'This join link is not valid',
    body: 'Check that you copied the whole link, then ask whoever shared it for a new one.',
  },
  expired: {
    title: 'This join link has expired',
    body: 'Ask whoever shared it to create a new one.',
  },
  revoked: {
    title: 'This join link was revoked',
    body: 'A workspace admin closed it. Ask them for a new one, or to invite you directly.',
  },
  exhausted: {
    title: 'This join link is fully used',
    body: 'It reached the number of people it was created for. Ask a workspace admin for a new one.',
  },
};

/** The `{ error }` envelope every failing route returns, when that is what came back. */
function errorMessageFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const message = (body as { error?: unknown }).error;
  return typeof message === 'string' && message !== '' ? message : null;
}

function Notice({
  title,
  body,
  showSignIn = false,
}: {
  title: string;
  body: string;
  showSignIn?: boolean;
}) {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {showSignIn && (
        <Link href="/login" className="inline-block text-sm text-primary hover:underline">
          Go to sign in
        </Link>
      )}
    </div>
  );
}

function JoinForm({ token, workspaceName }: { token: string; workspaceName: string }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedeemJoinLinkOutput | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await apiFetch('/api/join/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email: email.trim().toLowerCase(),
          ...(displayName.trim() !== '' ? { displayName: displayName.trim() } : {}),
        }),
        reportErrors: false,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        // The error envelope is a different shape from the success union — a
        // 429 from the rate limiter carries the message worth showing.
        setError(errorMessageFrom(body) ?? 'Could not join right now. Try again shortly.');
        return;
      }
      const parsed = RedeemJoinLinkOutputSchema.safeParse(body);
      if (!parsed.success) {
        setError('Could not join right now. Try again shortly.');
        return;
      }
      setResult(parsed.data);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null && result.ok) {
    return (
      <Notice
        title="Check your email"
        body={
          result.emailSent
            ? `We sent a sign-in link to ${email.trim().toLowerCase()}. Open it to finish joining ${result.workspaceName}.`
            : `You have been added to ${result.workspaceName}, but we could not send the sign-in email. Ask a workspace admin to resend it.`
        }
      />
    );
  }

  // The token was live when the page loaded and is not any more — someone
  // revoked it, it expired, or the last seat went to somebody else mid-form.
  if (result !== null && !result.ok) {
    const copy = REASON_COPY[result.reason];
    return <Notice title={copy.title} body={copy.body} showSignIn />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-display text-lg font-semibold">Join {workspaceName}</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we will send you a sign-in link. You will join as a member.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="joinEmail" className="text-sm font-medium">
            Email <span className="text-destructive">*</span>
          </label>
          <input
            id="joinEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={submitting}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="joinName" className="text-sm font-medium">
            Name
          </label>
          <input
            id="joinName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Smith"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={submitting}
          />
        </div>

        {error !== null && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Joining…' : 'Join workspace'}
        </button>
      </form>
    </div>
  );
}
