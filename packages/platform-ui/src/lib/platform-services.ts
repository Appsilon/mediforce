// Re-export shim — temporary, will be deleted.
//
// The real factory lives in `@mediforce/platform-api/services` (co-located
// with the handlers that consume it). This file exists only so the ~100+
// existing `@/lib/platform-services` imports across routes, server actions
// and server utilities keep working unchanged while the migration completes.
//
// End state (see `docs/headless-migration.md`, Phase 5):
//   - Every caller imports `getPlatformServices` directly from
//     `@mediforce/platform-api/services`.
//   - Every caller imports `getAppBaseUrl` from `@/lib/app-base-url`.
//   - This file is deleted.
//
// Until then, treat this file as a *bridge*, not an API — do not add new
// symbols here. If you need a new platform service, add it in
// `packages/platform-api/src/services/` and re-export it below only if it
// must be callable from `@/lib/platform-services` call sites that haven't
// been migrated yet.

export { getPlatformServices, type PlatformServices } from '@mediforce/platform-api/services';
export { getAppBaseUrl } from './app-base-url.js';
