// packages/platform-ui/src/lib/mediforce.ts
//
// Browser-side Mediforce client. Auth: Firebase ID token via `bearerToken`.
// `platform-api/client` stays free of Firebase — the knowledge lives in this
// wrapper, and it is funneled through a single helper (`getFirebaseIdToken`)
// that `apiFetch` also uses. One source of truth for the browser Bearer.
//
// For Node consumers (agent / CLI / MCP server), build your own instance
// with `new Mediforce({ baseUrl, apiKey })` — same contract, same type
// safety, different runtime.

import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { getFirebaseIdToken } from './firebase-id-token';

export const mediforce = new Mediforce({
  bearerToken: getFirebaseIdToken,
});

export { ApiError };
