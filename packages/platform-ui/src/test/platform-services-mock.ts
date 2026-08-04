/**
 * Base for a route test's `getPlatformServices` mock.
 *
 * Route smoke tests mock `@/lib/platform-services` with a hand-written object
 * literal holding only the repositories that route touches. Vitest module
 * factories are untyped, so TypeScript never checks those literals against
 * `PlatformServices` — a field nobody thought to include is simply `undefined`
 * at runtime.
 *
 * That is harmless for a repository (the test fails loudly on the missing
 * method) but silent for a **deployment flag**: `passwordAuthEnabled` is a
 * required `boolean` in production, and every consumer reads it as
 * `=== true`, so an omitted field quietly runs the route against the rare
 * password-auth-disabled deployment instead of the default one. A test can pass
 * while exercising the opposite branch from the one it names.
 *
 * Spreading through here fixes the direction: flags start at the value a normal
 * deployment has (password auth is ON unless `ENABLE_PASSWORD_AUTH=false` —
 * `isPasswordAuthEnabled` in platform-core), and a test that wants the opt-out
 * says so explicitly. Add every future deployment flag here for the same reason.
 */
interface DeploymentFlags {
  passwordAuthEnabled: boolean;
}

const DEPLOYMENT_FLAG_DEFAULTS: DeploymentFlags = {
  passwordAuthEnabled: true,
};

export function mockPlatformServices<T extends object>(services: T): DeploymentFlags & T {
  // Overrides last: a test that pins `passwordAuthEnabled: false` keeps it.
  return { ...DEPLOYMENT_FLAG_DEFAULTS, ...services };
}
