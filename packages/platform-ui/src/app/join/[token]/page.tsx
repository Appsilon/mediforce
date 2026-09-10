import { JoinFlow } from './join-flow';

/**
 * `/join/<token>` — the public landing page for a workspace join link
 * (ADR-0021).
 *
 * Deliberately outside `(app)`: a joiner has no session, and this page is what
 * starts the process of getting one. Everything below is client-side against
 * `/api/join/*`, because a handler is only ever reached through the HTTP
 * adapter layer (`api-boundaries.test.ts`) and an unauthenticated page is the
 * wrong place to start making exceptions to that.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card px-6 py-8">
        <JoinFlow token={token} />
      </div>
    </main>
  );
}
