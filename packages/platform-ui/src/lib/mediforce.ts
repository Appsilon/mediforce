// packages/platform-ui/src/lib/mediforce.ts
//
// Browser-side Mediforce client. After the Firebase Auth exit (ADR-0002 §6)
// the browser authenticates with the NextAuth httpOnly session cookie, which
// rides same-origin `/api/*` requests automatically — no `Authorization`
// header. The client is constructed with a `bearerToken` callback that always
// resolves `null` so no header is attached; the cookie is the sole carrier.
//
// For Node consumers (agent / CLI / MCP server), build your own instance with
// `new Mediforce({ baseUrl, apiKey })` — same contract, same type safety,
// different runtime.

import { Mediforce, ApiError } from '@mediforce/platform-api/client';

export const mediforce = new Mediforce({
  bearerToken: async () => null,
});

export { ApiError };
