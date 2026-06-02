---
phase: 21-alerting
plan: "02"
subsystem: notifications
tags: [webhook, slack, discord, config-api, cli, platform-settings]

# Dependency graph
requires:
  - phase: 21-alerting
    plan: "01"
    provides: PlatformSettingsRepository, platformSettingsRepo in getPlatformServices, syncWithRetry onAttemptFail
provides:
  - sendSyncFailureWebhook (Slack/Discord payloads, fire-and-forget)
  - sendTestWebhook (test ping, returns { ok, error? })
  - Config contract schemas (GetConfig, GetConfigByPrefix, SetConfig, TestWebhook)
  - Config handlers (getConfig, getConfigByPrefix, setConfig, testWebhook)
  - Routes /api/config and /api/config/test-webhook
  - Mediforce client config namespace (get, getByPrefix, set, testWebhook)
  - CLI mediforce config set/get/test-webhook
affects: [cron route, admin operators who set alert.webhook.* keys]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Slack payload format: { text: ":warning: *Title*\n..." }
    - Discord payload format: { content: "**Title**\n..." }
    - Fire-and-forget webhook via try/catch (never rethrow)
    - Config namespace in Mediforce class client via clientConfig rename (private field)
    - Positional CLI args for config set <key> <value> and config get <key>

key-files:
  created:
    - packages/platform-infra/src/notifications/sync-alert-webhook.ts
    - packages/platform-infra/src/notifications/__tests__/sync-alert-webhook.test.ts
    - packages/platform-api/src/contract/config.ts
    - packages/platform-api/src/handlers/config/get-config.ts
    - packages/platform-api/src/handlers/config/set-config.ts
    - packages/platform-api/src/handlers/config/test-webhook.ts
    - packages/platform-api/src/handlers/config/index.ts
    - packages/platform-api/src/handlers/config/__tests__/config.test.ts
    - packages/platform-ui/src/app/api/config/route.ts
    - packages/platform-ui/src/app/api/config/test-webhook/route.ts
    - packages/cli/src/commands/config-set.ts
    - packages/cli/src/commands/config-get.ts
    - packages/cli/src/commands/config-test-webhook.ts
  modified:
    - packages/platform-infra/src/index.ts
    - packages/platform-api/src/contract/index.ts
    - packages/platform-api/src/handlers/index.ts
    - packages/platform-api/src/client/index.ts
    - packages/platform-ui/src/app/api/cron/model-sync/route.ts
    - packages/cli/src/cli.ts

key-decisions:
  - "Renamed private constructor field from `config` to `clientConfig` in Mediforce class to expose readonly `config` namespace without naming conflict"
  - "Config routes use direct NextResponse pattern (not createRouteAdapter) — system-level ops without CallerScope needed"
  - "sendSyncFailureWebhook is fire-and-forget: try/catch wraps the fetch, errors logged but never rethrown to cron route"

# Metrics
duration: 7min
completed: 2026-06-02
---

# Phase 21 Plan 02: Webhook Sender and Config API Summary

**Slack/Discord webhook notification on sync failure (fire-and-forget), plus config get/set/test-webhook via REST API and CLI**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-02T16:45:39Z
- **Completed:** 2026-06-02T16:52:44Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments

- `sendSyncFailureWebhook(settingsRepo, context)` reads `alert.webhook.enabled/url/type` from platform_settings, formats Slack or Discord payload, POSTs fire-and-forget (fetch errors caught + logged, never rethrown)
- `sendTestWebhook(settingsRepo)` sends test message and returns `{ ok, error? }`
- 10 unit tests covering all 8 behavior cases (disabled, no URL, Slack format, Discord format, unknown type defaults to Slack, fetch error swallowed, test webhook success, test webhook with no URL, test webhook fetch error)
- Cron route wired: calls `sendSyncFailureWebhook` in catch block after final sync failure, after audit emit
- Config contract schemas (`GetConfigInput/Output`, `GetConfigByPrefixInput/Output`, `SetConfigInput/Output`, `TestWebhookOutput`) exported from platform-api
- Config handlers (`getConfig`, `getConfigByPrefix`, `setConfig`, `testWebhook`) with 6 passing unit tests using `InMemoryPlatformSettingsRepository`
- Routes at `/api/config` (GET with `?key=` or `?prefix=`, PUT) and `/api/config/test-webhook` (POST)
- `Mediforce` client `config` namespace: `get`, `getByPrefix`, `set`, `testWebhook` — renamed private `config` constructor field to `clientConfig` to avoid naming conflict
- CLI commands `mediforce config set/get/test-webhook` registered in `cli.ts`

## Task Commits

1. **Task 1: Webhook sender with Slack/Discord payloads and unit tests** - `51146fd1` (feat)
2. **Task 2: Config API (contract, handlers, routes), Mediforce client, and CLI commands** - `4e4d9467` (feat)

## Files Created/Modified

- `packages/platform-infra/src/notifications/sync-alert-webhook.ts` - sendSyncFailureWebhook + sendTestWebhook
- `packages/platform-infra/src/notifications/__tests__/sync-alert-webhook.test.ts` - 10 unit tests
- `packages/platform-api/src/contract/config.ts` - Zod schemas for all config operations
- `packages/platform-api/src/handlers/config/get-config.ts` - getConfig, getConfigByPrefix handlers
- `packages/platform-api/src/handlers/config/set-config.ts` - setConfig handler
- `packages/platform-api/src/handlers/config/test-webhook.ts` - testWebhook handler (delegates to sendTestWebhook)
- `packages/platform-api/src/handlers/config/index.ts` - re-exports all config handlers
- `packages/platform-api/src/handlers/config/__tests__/config.test.ts` - 6 handler tests
- `packages/platform-ui/src/app/api/config/route.ts` - GET (key/prefix) + PUT route
- `packages/platform-ui/src/app/api/config/test-webhook/route.ts` - POST route
- `packages/cli/src/commands/config-set.ts` - mediforce config set command
- `packages/cli/src/commands/config-get.ts` - mediforce config get command (with wildcard prefix support)
- `packages/cli/src/commands/config-test-webhook.ts` - mediforce config test-webhook command

## Decisions Made

- **clientConfig rename**: The `Mediforce` class constructor already used `private readonly config: ClientConfig`. To expose `readonly config: { get, getByPrefix, set, testWebhook }` as a public namespace (matching the CLI `mediforce config` branch), the private field was renamed to `clientConfig`. All `this.config.*` references updated accordingly. No behavior change.
- **Direct route pattern**: Config routes use `NextResponse` directly (not `createRouteAdapter`) because they don't need `CallerScope` — they're system-level key-value operations against `platformSettingsRepo`, same as the cron and model-sync routes.
- **Fire-and-forget confirmed**: `sendSyncFailureWebhook` wraps the fetch in try/catch internally. The cron route's catch block does not need to wrap it — errors are logged but the sync failure response is unaffected.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Alert pipeline is complete: failed syncs emit audit + fire Slack/Discord webhook
- `mediforce config set alert.webhook.url <URL>` configures the webhook without code changes
- `mediforce config set alert.webhook.type slack|discord` sets the format
- `mediforce config set alert.webhook.enabled true|false` toggles without removing URL
- Phase 21 alerting is complete

## Self-Check: PASSED

All key files found on disk. Commits 51146fd1 and 4e4d9467 verified in git log.
