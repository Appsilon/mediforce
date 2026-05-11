# GitHub App OAuth Connect — first-install + re-connect

Status: draft for review (Marek, Filip).
Authors: claude (drafting), Marek (problem owner).
Related PRs: [#318](https://github.com/Appsilon/mediforce/pull/318) (admin preset), [#339](https://github.com/Appsilon/mediforce/pull/339) (binding preset), #341 (rollout notes).
Tracking: [#331](https://github.com/Appsilon/mediforce/issues/331) (self-host MCP, out of scope).

## TL;DR

After PR #318 ships, the admin's GitHub provider preset sets
`authorizeUrl = https://github.com/apps/<slug>/installations/new`. That URL
serves first-install + OAuth in one redirect, but on a user who already has
the App installed it lands on the install settings page and **never returns
an OAuth code** to our callback. A user cannot re-Connect a binding without
uninstalling the App on github.com first.

The recommendation is **Option B**: split the single Connect button into two
explicit actions on the binding row — "Install / configure App" (no state,
goes to `installations/new`) and "Connect" (signed state, goes to
`/login/oauth/authorize`). Schema adds one optional field
`installUrl?: string` on the provider config. No new persistent state.
Existing rows migrate forward automatically.

## 1. Current state

### Provider config (post-#318, on `feat/oauth-provider-seeding`)

`packages/platform-core/src/schemas/oauth-provider.ts` preset:

```ts
github: {
  authorizeUrl: 'https://github.com/apps/your-app-slug/installations/new',
  tokenUrl:     'https://github.com/login/oauth/access_token',
  userInfoUrl:  'https://api.github.com/user',
  scopes:       ['read:user'],
}
```

The admin form (`provider-form.tsx` on the same branch) has a "GitHub App
slug" input that rewrites `authorizeUrl` to
`https://github.com/apps/<slug>/installations/new` on every keystroke. The
schema field `authorizeUrl` is a generic `z.string().url()` — nothing
enforces the `/installations/new` shape, but the form pins it.

### Connect button (current `main`)

`oauth-connection-status.tsx::handleConnect` → POST
`/api/agents/[id]/oauth/[provider]/start` → server signs state + builds
`authorizeUrl?client_id=…&redirect_uri=…&state=…&response_type=code&scope=…&code_challenge=…`
→ client `window.location.href = authorizeUrl`.

Callback `/api/oauth/[provider]/callback` verifies state, exchanges code for
token, fetches userinfo, persists `AgentOAuthToken` at
`namespaces/{ns}/agentOAuthTokens/{agentId}__{serverName}`, redirects to
agent page with `?connected=<serverName>`.

### Where the OAuth code is lost

GitHub treats `github.com/apps/<slug>/installations/new` as two different
landing pages depending on installation state for the redirect target
account/org:

| State                                  | UI shown                            | After confirm                                              |
| -------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| No install on any account user can pick | Repo picker → "Install"             | Install → OAuth consent → redirect to `redirect_uri?code=…&state=…` ✓ |
| Install already exists                 | "Configure access" / repo picker    | Save → redirect to `/organizations/<org>/settings/installations/<id>` — **no code, no state** ✗ |

The state param + `redirect_uri` are passed through on the install path but
ignored on the reconfigure path. This is intentional on GitHub's side —
`installations/new` is documented as install-time only. The user OAuth code
issuance is the job of `/login/oauth/authorize`.

`installations/new` accepts `state`, `redirect_uri`, and renders the App's
install page; `/login/oauth/authorize` renders the user-server consent page
and returns `code`. Per GitHub docs, the App's "Setup URL" is the only
post-install hook that fires every install/reconfigure — it receives
`installation_id` + the App's configured `state` but **does not** carry an
OAuth code.

### Concrete repro (Marek, today)

1. Mediforce Staging App already installed on `Appsilon` org (from #338).
2. Create AgentDefinition in `appsilon`, github MCP binding (OAuth, provider id `github`).
3. Click Connect → land on `Appsilon` org install page (configure access).
4. Pick `Appsilon/core-contributor`, Save → redirect to
   `/organizations/Appsilon/settings/installations/<id>`. No callback fired.
5. Back on mediforce: binding still "Not connected", token write never
   happened. At spawn time agent fails with
   `OAuth token for MCP server 'github' (provider 'github') is not connected`.

## 2. Options

### Option A — single button, conditional URL

Connect endpoint checks whether the connecting user has an existing
installation visible to the App for any of their accounts. If yes →
`/login/oauth/authorize`. If no → `installations/new`.

Pros:
- One button in UI, no extra concept exposed to users.

Cons:
- "Visible installations" requires a JWT-authed call to GitHub
  (`GET /users/{username}/installation` or
  `GET /app/installations` filtered by account) — needs the App's private
  key on the platform. We don't ship that secret today; would have to add
  it to provider config + cycle it on every staging deploy.
- Heuristic is fragile: user has install on org A but wants to add org B.
  Predicate "has any install" returns true → we route to `/authorize` →
  user can't reach the repo picker for org B without going to github.com.
- Adds a JWT-signing dependency (jose / @octokit/auth-app) to platform-ui.
- Re-adding repos to an existing install still needs the user to *first*
  hit `installations/new`. So the button is "Connect (might silently
  install)" — discoverability collapses.

### Option B — two explicit actions (recommended)

The binding row exposes two actions when binding uses GitHub App OAuth:

```
[ Install / configure App ]   [ Connect ]
```

- **Install / configure App** → opens
  `https://github.com/apps/<slug>/installations/new` in a new tab. No
  state, no redirect back to mediforce. User picks org + repos, saves, done.
  Idempotent: clicking again jumps straight to the "Configure access" page
  if already installed, which is exactly what the user wants when they
  need to add a new repo.
- **Connect** → POST `start` → server uses `installUrl`-less path: signs
  state, redirects to `/login/oauth/authorize?client_id=…&state=…&redirect_uri=…`.
  GitHub renders the user-to-server consent screen ("Authorize Mediforce
  Staging"). Code returned, callback persists token. Works whether the App
  is installed on 0, 1, or N orgs.

Pros:
- Mirrors GitHub's actual two-page model. Each button does exactly one thing.
- Re-Connect always works — no installation_id state to track.
- Adding repos later: click "Install / configure App", pick repos, done.
  No need to re-Connect because the existing user token's permissions
  follow the App's install permissions.
- Zero new persistent state. No webhooks. No JWT.
- Provider preset becomes safer: `authorizeUrl` always points at
  `/login/oauth/authorize` (boring, well-defined).

Cons:
- Two buttons instead of one. Needs a sentence of help text on the binding
  row explaining first-time order ("Install first, then Connect").
- First-time user has an extra click vs. the "all-in-one" promise of #318.
  Tradeoff: that "promise" is broken today for the re-connect half of users.

### Option C — install off-platform, Connect uses `/authorize` only

Drop the install URL entirely from mediforce UI. Admin's setup runbook
documents "click Install on github.com first, then come back and click
Connect". Provider's `authorizeUrl` is `/login/oauth/authorize`.

Pros:
- Simplest implementation. Revert preset to `/login/oauth/authorize`. Done.

Cons:
- Worst onboarding moment for any non-admin user wiring up a binding.
  They hit Connect, see "Authorize Mediforce" with empty repo list, save,
  agent run fails with "no repo access". Loop until they figure out they
  need to visit github.com.
- Most pharma users don't admin their own GitHub org — admin-side hand-off
  becomes part of every onboarding.

### Option D — server-to-server installation tokens

Use the App's installation token (`ghs_*`) directly, no per-user OAuth.
Sidesteps this whole problem. Requires self-hosting `github-mcp-server`
(hosted Copilot endpoint rejects `ghs_*`). Tracked separately in [#331](https://github.com/Appsilon/mediforce/issues/331).

Pros:
- No user OAuth dance at all.

Cons:
- Loses per-user audit trail (every action is "Mediforce App on behalf of installation").
- Requires self-hosted MCP server — infra work + ongoing maintenance.
- Out of scope for this task by explicit constraint.

## 3. Recommendation

**Option B**. Two reasons that outweigh "one extra click":

1. The two-page model is GitHub's, not ours. Pretending otherwise (Option A)
   means we keep paying for the abstraction every time GitHub changes the
   install flow. Two buttons surface reality.
2. Zero new persistent state means zero new failure modes. Webhooks for
   `installation_id` capture would need delivery retries, secret rotation,
   and a story for "the webhook never arrived". `installations/new` opened
   in a tab with no state has nothing to fail.

The cost of the second button is one line of help text on the binding row.
Acceptable.

## 4. Schema changes

`OAuthProviderConfigSchema` gets one optional field:

```ts
/** URL that opens the provider's install/configure UI (e.g. GitHub App
 *  installations/new). Surfaced as a separate "Install / configure" button
 *  on bindings that use this provider. Optional — when unset, only the
 *  OAuth Connect button is shown. */
installUrl: z.string().url().optional(),
```

`authorizeUrl` reverts to `/login/oauth/authorize` in the GitHub preset.
The admin form's slug field now writes the slug into **two** spots:
- `authorizeUrl` stays `https://github.com/login/oauth/authorize` (fixed,
  not slug-derived — same for every GitHub App).
- `installUrl` = `https://github.com/apps/<slug>/installations/new`.

`scopes` stays `['read:user']` (App ignores OAuth scopes, but we still
need user-info access).

Public schema (`PublicOAuthProviderConfigSchema`) already inherits via
`.omit({ clientSecret })`, so `installUrl` flows through.

## 5. State storage

None required. Option B is stateless on the mediforce side:
- "Install / configure App" → window.open, no callback, no tracking.
- "Connect" → existing OAuth start/callback flow, unchanged token write
  path at `namespaces/{ns}/agentOAuthTokens/{agentId}__{serverName}`.

No webhook handler. No Setup URL handler. No `installation_id` row.

If later we want to surface "this binding's GitHub App is installed on org
X" status in the UI, that's a follow-up that adds an
`/api/agents/[id]/github/install-status` endpoint reading from GitHub via a
short-lived App JWT. Not required for the bug fix.

## 6. Migration

Existing `appsilon` and `mediforce` namespace `github` provider docs
currently store
`authorizeUrl = https://github.com/apps/<slug>/installations/new`.

Two phases:

1. **Code-side (deploy of this PR):**
   - Add `installUrl` (optional) to schema. Existing docs pass validation
     unchanged (new field is optional).
   - Add a server-side fallback in the OAuth start endpoint: if the
     provider's `authorizeUrl` looks like `github.com/apps/.+/installations/new`,
     log a deprecation warning and **rewrite at request time** to
     `https://github.com/login/oauth/authorize`. This keeps in-flight
     Connect attempts working the instant the deploy lands.
   - Admin UI renders an inline warning on any provider doc with the
     legacy shape, with a one-click "Update" button that sets
     `installUrl = <derived from old authorizeUrl>` and
     `authorizeUrl = https://github.com/login/oauth/authorize`.

2. **Operator action (after deploy):**
   - Open each affected provider in the admin UI, click "Update". 30
     seconds per namespace. No CLI command needed but `pnpm exec mediforce
     oauth-providers update` could do the same edit if we want a scripted
     path for staging + prod.

The fallback rewrite stays in the codebase for at least one full release
cycle so legacy rows on long-running namespaces don't break silently.

## 7. UI changes (additive)

`OAuthConnectionStatus`:

```
┌─ Not connected ───────────────────────────────────────────────┐
│ ⛓ Not connected — no OAuth token for this binding             │
│   [ Install / configure App ↗ ]   [ Connect ]                  │
│   First time? Install the App, pick repos, then Connect.       │
└────────────────────────────────────────────────────────────────┘
```

- "Install / configure App" renders only when the selected provider has
  `installUrl` set. Opens in `target=_blank`.
- "Connect" unchanged endpoint shape, but server now routes to
  `/login/oauth/authorize`.
- Connected state: still shows "Connected as @login", plus a small "Add
  repos to App ↗" link that opens `installUrl` (when set). Lets users
  add a repo to an existing install without re-Connecting.

Admin provider form (`provider-form.tsx` on #318 branch):
- "GitHub App slug" input now writes `installUrl` (slug-derived) and
  leaves `authorizeUrl` pinned at `/login/oauth/authorize`. Single source
  of truth: the App slug.
- Setup runbook reorders: "1) Register App. 2) Set Callback URL. 3) Paste
  App slug — we'll wire both URLs. 4) Save. 5) On the agent binding row,
  click Install first, then Connect."

## 8. Testing

Unit:
- `oauth-provider.ts`: `installUrl` accepted, rejected if not a URL.
- `provider-form.tsx`: slug field writes both `installUrl` (slug-derived)
  and `authorizeUrl` (pinned).
- Start endpoint: legacy `authorizeUrl = .../installations/new` rewrites
  to `/login/oauth/authorize` + warning logged.
- `oauth-connection-status.tsx`: renders "Install / configure App" button
  iff provider has `installUrl`. Renders the "Add repos to App" link iff
  connected + `installUrl` set.

Journey (`packages/platform-ui/src/test/*-journey.test.ts`):
- Connect flow against a mocked GitHub returning a code on
  `/login/oauth/authorize` (existing OAuth journey already covers this —
  reuse).
- New: provider config with both URLs serializes/deserializes cleanly
  through admin POST/PATCH.

E2E (delegated): refresh `github-mcp-preset.journey.ts` for the new
two-button binding row layout.

## 9. Out of scope

- Self-hosting `github-mcp-server` ([#331](https://github.com/Appsilon/mediforce/issues/331)).
- Two-namespace provider visibility quirk (separate spawned task).
- `apps/sdtm-rule-migration/` — Marek's in-flight branch.
- Auto-install via webhook → token write. Possible follow-up if we ever
  see Setup URL handling pay off; not needed for the bug fix.

## 10. Open questions

a) Should "Install / configure App" be a button or a plain link? Button
   matches "Connect" visually but it doesn't post anything. Lean: button-
   styled `<a target="_blank">` — looks like an action but is a navigation.

b) Do we want the start endpoint's legacy rewrite to be permanent or to
   sunset after a release? Lean: keep one release, then turn into a hard
   400 with a pointer to the admin UI's "Update" button.

c) Worth a one-line `pnpm exec mediforce oauth-providers migrate-github`
   for scripted migration? Lean: yes, costs ~30 lines + tracks dogfooding
   rule.
