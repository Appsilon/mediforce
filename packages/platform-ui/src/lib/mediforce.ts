// packages/platform-ui/src/lib/mediforce.ts
//
// Browser-side Mediforce client. Auth: Firebase ID token via `bearerToken`
// — `platform-api/client` stays free of Firebase; the knowledge lives in
// this wrapper.
//
// For Node consumers (agent / CLI / MCP server), build your own instance
// with `new Mediforce({ baseUrl, apiKey })` — same contract, same type
// safety, different runtime.

import { Mediforce, ApiError } from '@mediforce/platform-api/client';

export const mediforce = new Mediforce({
  bearerToken: async () => {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;
    return user === null ? null : user.getIdToken();
  },
});

export { ApiError };
