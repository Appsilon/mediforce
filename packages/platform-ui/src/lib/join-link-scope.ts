import type { CallerScope } from '@mediforce/platform-api/repositories';
import { defaultBuildScope } from './route-adapter';

/**
 * The scope the public join surface runs under (ADR-0021).
 *
 * A system actor, because there is no caller — the TOKEN is the authorization,
 * and `previewJoinLink` / `redeemJoinLink` are written never to consult
 * `scope.caller`. Every other route reaches a scope through
 * `createRouteAdapter`, which insists on credentials; these two cannot, so they
 * build it the one documented other way (`defaultBuildScope`, the same seam the
 * binary-download route uses).
 *
 * Shared by both public join routes so there is exactly one place where an
 * unauthenticated request acquires a system scope.
 */
export function publicJoinScope(): CallerScope {
  return defaultBuildScope({ kind: 'apiKey', isSystemActor: true });
}
