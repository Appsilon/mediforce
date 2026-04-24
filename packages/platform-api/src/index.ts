// Contract schemas — request/response shapes for every API endpoint.
// Import these from `@mediforce/platform-api/contract` when you only need types.
export * from './contract/index.js';

// Pure handler functions — framework-free, dep-injected, testable with in-memory repos.
// Import these from `@mediforce/platform-api/handlers` when mounting in an HTTP adapter.
export * from './handlers/index.js';

// Typed errors a handler may throw to signal a non-500 HTTP status.
export * from './errors.js';

// Services (factory + seeding) intentionally NOT re-exported here — import from
// `@mediforce/platform-api/services` so consumers of `/contract` or `/handlers`
// never evaluate Firestore/Firebase-admin wiring transitively.
