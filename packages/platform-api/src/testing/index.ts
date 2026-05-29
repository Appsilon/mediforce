// Test helpers for downstream packages exercising platform-api handlers.
// Importable as `@mediforce/platform-api/testing`.
export { createTestScope, userCaller } from '../repositories/__tests__/create-test-scope.js';
export type { TestScopeOverrides } from '../repositories/__tests__/create-test-scope.js';
export { InMemoryNamespaceRepo } from './in-memory-namespace-repo.js';
