import { handlers } from '@/auth';

// NextAuth route handler (PLAN-0002 §2.2). Serves the sign-in, callback,
// session, csrf and sign-out endpoints under /api/auth/*. These are PUBLIC —
// proxy.ts allowlists /api/auth/* because you cannot present a session while
// obtaining one.
export const runtime = 'nodejs';
export const { GET, POST } = handlers;
