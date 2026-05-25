// Contract schemas — request/response shapes for every API endpoint.
// Import these from `@mediforce/platform-api/contract` when you only need types.
export * from './contract/index.js';

// Pure handler functions — framework-free, dep-injected, testable with in-memory repos.
// Import these from `@mediforce/platform-api/handlers` when mounting in an HTTP adapter.
export * from './handlers/index.js';

// Typed errors handlers may throw — mapped to HTTP statuses by the route adapter.
// Import from `@mediforce/platform-api/errors`.
export * from './errors.js';

// Caller identity + namespace policy helpers — pure, framework-free.
// Import from `@mediforce/platform-api/auth`.
export * from './auth.js';

// Authorization wrapper layer (ADR-0004). Handlers receive a `CallerScope`
// instead of raw repositories; every read/write is gated by caller workspace
// membership. Import from `@mediforce/platform-api/repositories`.
export * from './repositories/index.js';

// Services (factory + seeding) intentionally NOT re-exported here — import from
// `@mediforce/platform-api/services` so consumers of `/contract` or `/handlers`
// never evaluate Firestore/Firebase-admin wiring transitively.
