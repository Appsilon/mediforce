// packages/platform-ui/src/lib/mediforce.ts
//
// Browser-side Mediforce client. After the Firebase Auth exit (ADR-0002 §6)
// the browser authenticates with the NextAuth httpOnly session cookie, which
// rides same-origin `/api/*` requests automatically — no `Authorization`
// header. The client uses the sanctioned browser fetch wrapper so the cookie
// remains the sole carrier and failed 4xx responses can be surfaced globally.
//
// For Node consumers (agent / CLI / MCP server), build your own instance with
// `new Mediforce({ baseUrl, apiKey })` — same contract, same type safety,
// different runtime.

import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { apiFetch } from './api-fetch';

export const mediforce = new Mediforce({
  fetch: apiFetch,
});

// Same client, but with the global 4xx toast suppressed. Use for calls whose
// caller already renders a specific, detailed error locally (e.g. a workflow
// save's validation-issue toast) — otherwise the generic listener and the
// local handler both fire, producing two toasts for one failed request.
export const mediforceSilent = new Mediforce({
  fetch: (input, init) => apiFetch(input, { ...init, reportErrors: false }),
});

export { ApiError };
