import {
  PublicConnectionSchema,
  type Connection,
  type PublicConnection,
} from '@mediforce/platform-core';
export { requireAdminForNamespace } from '../oauth-providers/helpers';

/** Strip OAuth token material from a Connection before it leaves the API
 *  surface. `accessToken` and `refreshToken` are never serialized to UI;
 *  the Public shape carries everything else (status fields like
 *  `expiresAt`, `accountLogin`, `connectedAt` so the UI can render
 *  "Connected as octocat — expires in 23 minutes").
 *
 *  Goes through `PublicConnectionSchema.transform`, so a regression that
 *  added a new secret-bearing field would fail parse in tests rather
 *  than silently leak. */
export function toPublicConnection(connection: Connection): PublicConnection {
  return PublicConnectionSchema.parse(connection);
}
