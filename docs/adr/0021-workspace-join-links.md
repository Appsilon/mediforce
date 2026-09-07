---
status: accepted
audience: engineers
last_reviewed: 2026-09-07
---

# ADR-0021: A join link authorizes membership; the mailbox still authorizes the session

- **Date:** 2026-09-07
- **Authors:** Krystian Zieliński (@krystianzielinski)
- **Amends:** [ADR-0002](./0002-firebase-auth-to-nextauth.md) §4a — the
  email-domain allowlist stops being the *only* thing that authorizes a
  sign-in. Nothing else in ADR-0002 changes: database sessions, the Email
  provider's no-self-registration gate, and §4b verified-email linking all
  stand.
- **Coordinates with:** [ADR-0019](./0019-workspace-scoped-roles.md) /
  [ADR-0020](./0020-built-in-roles-and-default-workflow-access.md) — a join
  link grants a **Membership**, never a process Role.

## Context

Onboarding a room full of people — a workshop, a customer demo, a pilot
cohort — has no path today. The only one that exists is
`inviteUser` (`POST /api/users/invite`): an owner/admin types one email,
`seedInvite` writes the `auth_users` row plus the `workspace_members` row in
one transaction, and a one-time 7-day activation link goes out. That works,
and for a known roster it stays the right tool. It requires knowing every
address up front, one at a time, through a form — and there is no CLI command
for it either.

The obvious shortcut is to let people sign themselves in. The codebase
deliberately forecloses it: `shouldSendMagicLink` sends a login link **only**
to an address that already has an `auth_users` row, so magic-link cannot
self-register. That leaves Google OAuth as the single self-registration
vector, and it is gated by exactly one thing — `ALLOWED_EMAIL_DOMAINS` in the
`signIn` callback. Opening that for a workshop means either enumerating every
attendee's employer domain in a deployment env var, or setting the `*`
sentinel and accepting that any Google account on earth can register on
production until someone remembers to revert it. Neither is a mechanism; both
are a person being careful.

There is also a latent bug behind the same gate. `inviteUser` never consults
`ALLOWED_EMAIL_DOMAINS`, but sign-in does. An admin can today invite
`alice@external.com`, `seedInvite` writes her rows, the activation email is
sent — and every route she can reach with that link rejects her: the magic-link
gate refuses because her domain fails, and Google's `signIn` callback refuses
for the same reason. The invite succeeds and the account is unusable. The
allowlist is enforced as if it were the only authorization in the system, when
an admin's deliberate invite is plainly another one.

## Decision

**1. A Join Link is a first-class object, not a reusable magic link.**
New table `workspace_join_links`: `id`, `workspace`, `token_hash`, `membership`,
`expires_at`, `max_uses`, `uses`, `created_by`, `created_at`, `revoked_at`.
Only the hash is stored; the plaintext token is shown once, at creation, and is
never recoverable. This is not the Auth.js verification-token table — those are
single-use and bound to one identifier, which is precisely what a join link
is not.

**2. Minted from workspace settings, by the same people who can invite.**
The Members section of `/[handle]/settings` already computes `canManageMembers`
(owner or admin) to reveal **Invite user**; **Create join link** sits beside it
under that same flag, with `assertCallerIsNamespaceAdmin` enforcing it
server-side. Organizations only — a workspace with `type === 'personal'` may
not mint one. A personal workspace is one person's own space; strangers
joining it is not a shape we want to have to reason about.

**3. A link grants `member`. Always.**
Not `owner` — that is the seat that can delete the workspace. And not `admin`
either: **revised 2026-09-07, during implementation.** The original text let the
minting admin choose between `member` and `admin`, on the reasoning that the
admin is making a deliberate choice. They are, but not about a *person* — the
mailbox round-trip decision 4 turns on controls who gets the **session**, never
who gets the **seat**. Whoever holds the link types an address, so an `admin`
link hands workspace administration — inviting, minting further links, managing
members — to whoever photographs a slide. Nothing in the workshop motion that
justifies this ADR needs an admin cohort, and the choice's whole value was
saving a promotion that is one command.

So there is no membership dimension: no input, no column, and nothing for a
future reader to wonder about. Promoting someone stays a deliberate act by a
named admin (`namespace set-member-role`).

**4. Redeeming seeds an account; it does not open a session.**
`/join/<token>` validates the token, collects an email, and then calls the
**same `seedInvite`** and sends the **same activation email** the admin invite
path already uses. The token is what authorizes *joining the workspace*; the
emailed link is what authorizes *the session*.

This is the load-bearing decision. A link shared into a room, put on a slide,
or turned into a QR code must never itself be a credential that opens a
session — a photograph of the screen would be an account. Splitting it means a
leaked link cannot be replayed into anybody's account, and everyone who ends up
in the workspace has a mailbox they demonstrably control. The cost is one email
round-trip during onboarding, which is the cost the invite path already pays.

**5. A seeded account is authorized to sign in, regardless of its domain.**
ADR-0002 §4a is amended: the `signIn` callback admits an email when its domain
is allowlisted **or** an `auth_users` row already exists for it. The same
relaxation applies to the `shouldSendMagicLink` gate, whose `domainAllowed`
term becomes redundant with its `userExists` term and is dropped.

`ALLOWED_EMAIL_DOMAINS` keeps doing the job it was introduced for: it is what
stops an arbitrary Google account from self-registering on a deployment. It was
never meant to overrule a workspace admin who deliberately added someone. After
this change the allowlist governs **self-service** sign-in — the open door §4a
was written to close — while an admin's act of seeding governs the rest. That
also fixes the unusable-invite bug above, which is a pre-existing defect this
ADR happens to be the right place to resolve.

The rejected reading is to leave §4a absolute and require operators to add
every attendee domain to a deployment env var before each workshop. That is a
production config change per event, performed under time pressure, whose
failure mode is silent — and it would still leave admin invites to external
addresses broken.

**6. Rate limiting ships with the route, not after it.**
`/join` is public and sends mail on demand, which is exactly the exposure that
`/api/auth/resend-setup-link` already carries. `api/tickets/rate-limit.ts`
already implements a per-key windowed bucket; generalize it into a shared
keyed limiter and apply it here, keyed by IP plus token. Deferring this is how
the endpoint becomes a mail relay.

**7. Personal-workspace bootstrap is untouched.**
A join link grants workspace membership and nothing else. The joiner's personal
workspace is created the way every other user's is — lazily and idempotently in
the `getMe` handler on their first authenticated page load (ADR-0002 §4a,
"Shipped as"). Handle generation stays in exactly one place.

## Consequences

- **The deployment gains one public, mail-sending endpoint.** Accepted, with
  decision 6 as the mitigation.
- **Revoking a link does not remove anyone.** People who already joined stay
  members; removing them is `namespace remove-member`, as it is for any other
  member. A link is an entrance, not a tenancy.
- **`/join` must not become an enumeration oracle.** A valid token plus an
  address that is already a member answers identically to one that is not,
  matching the anti-enumeration stance `resend-setup-link` already holds. An
  expired, revoked, or exhausted *token* is different: the holder possesses the
  secret, so telling them plainly that it expired leaks nothing and is what
  they need to know.
- **Audit gains three actions:** `invitation.link_created`,
  `invitation.link_redeemed`, `invitation.link_revoked`, alongside the existing
  `invitation.created`. Redemption records the token id, not the token.
- **Sign-in authorization is now two-term.** A future reader of the `signIn`
  callback will find a check that no longer reads "the allowlist decides". That
  is the point of this ADR; §4a's own text is amended rather than left to be
  reconciled by whoever notices next.
- **CONTEXT.md gains a `Join Link` term** under Identity / auth, adjacent to
  Membership, when this is implemented.

## Considered alternatives

- **The link signs you straight in.** Fastest possible onboarding — and it makes
  a screenshot of a slide into an account. Rejected on decision 4.
- **`ALLOWED_EMAIL_DOMAINS=*` for the duration of the event.** Zero code. It
  opens production self-registration to every Google account in existence and
  relies on a human remembering to revert it afterwards. Rejected.
- **Enumerate attendee domains in the allowlist per event.** No new surface, but
  a production config change per workshop, with a silent failure mode, that
  still leaves external invites broken. Rejected as decision 5.
- **Pre-collect the roster and bulk-invite.** Not rejected — this stays the
  right tool whenever the roster is known in advance, and it needs no new
  platform surface. It does not cover walk-ins, and it is the thing a repeated
  workshop motion makes tedious. Join links complement it.

## Out of scope

- **CLI parity ships in the same epic, not later** (AGENTS.md §4). Neither
  `mediforce users invite` nor a join-link command exists today; both land as
  route-adapter-thin commands over the existing handlers.
- Self-service workspace creation, public sign-up, and billing. A join link is
  minted by an admin for a workspace that already exists.
- SSO-backed cohorts. A customer with an OIDC IdP onboards through it.

## Documentation drift found while writing this

ADR-0002's "Deferred (issue #1048)" list carried a third bullet — rate-limiting
on the activation / magic-link / resend sends — that is **not in issue #1048**,
whose body covers only the forced-password-change guard and the Google
exemption. `resend-setup-link/route.ts` inherited the mistake in a code comment
reading "Rate-limiting is deferred to #1048". The sibling issue #1003 covers
password-login rate limiting only.

**Fixed in the implementation.** ADR-0002 now carries a separate "Deferred (no
issue yet)" heading for that bullet, saying plainly that it is not in #1048 and
needs an issue of its own; the `resend-setup-link` comment says the same. Both
point at the shared limiter decision 6 shipped, so whoever picks the remaining
work up has the tool already built.

## Shipped as

Implemented 2026-09-07. Deviations and additions worth recording:

- **Decision 3 narrowed to `member`-only during implementation**, for the
  reasoning now written into the decision itself. The membership column,
  contract field, CHECK constraint, UI select and CLI flag all came out with
  it; migration `0047` was edited in place rather than stacked on, since it had
  not merged anywhere (`platform-infra/README.md`: forward-only and immutable
  *once merged*).
- **The settings placement differs from decision 2.** §2 says **Create join
  link** "sits beside" **Invite user**. It ships as its own **Join links**
  section directly below Members, because the feature needs a list (which link
  is live, how many used it, which to revoke) and a button beside another button
  has nowhere to put one. The gate is exactly as specified — `canManageMembers`
  in the UI, `assertCallerIsNamespaceAdmin` server-side.
- **Two public routes, not one.** `POST /api/join/preview` (read-only, resolves
  the workspace name for the page) and `POST /api/join/redeem`. The page was
  first written to call `previewJoinLink` directly as a server component, which
  `api-boundaries.test.ts` correctly rejected: a handler is only ever reached
  through the HTTP adapter layer, and an unauthenticated page is the wrong place
  to start making exceptions. Both routes take the token in the **body**, so it
  stays out of the API's access logs; the page URL that carries it is
  unavoidable, but there was no reason to copy it into a second log line.
- **The limiter is three budgets, because one of them is spoofable.** Any key
  derived from `x-forwarded-for` is caller-controlled, so a script that rotates
  the header gets a fresh bucket per request — an address-keyed budget alone is
  a suggestion, and §6's whole point is that this endpoint must not become a
  mail relay. Redemption therefore also carries a budget keyed on the token
  hash **alone** (60/hour): nothing a caller sends can move it, and it is what
  actually holds. The per-(address, token) budget stays at 5/hour as the cheap
  first line. Preview only reads and sends no mail: 120/hour per address, loose
  enough for a room behind one conference NAT.

  `clientAddress` reads the **last** hop of `x-forwarded-for`, not the first —
  every proxy appends, so the last entry is what our own reverse proxy observed
  and anything earlier is what the client chose to send. `password-login`'s
  `clientIpFrom` deliberately still reads the first: an audit record wants the
  conventional "original client" and understands it is spoofable. The two look
  alike and want opposite things, which is why they were not merged.

  Keys everywhere carry the token's SHA-256, never the token — a limiter's map
  outlives the request. The limiter also sweeps expired buckets, since a map
  keyed on anything caller-influenced otherwise grows one permanent entry per
  request.
- **Decision 4's "same `seedInvite`, same activation email" is now literal.**
  The step `inviteUser` performed inline was extracted to
  `handlers/users/seed-member.ts` and both callers use it, so a redemption
  cannot drift into a second implementation that merely agrees today.
- **Decision 5's second term is a column, not "a row exists" — the ADR's own
  test was too broad.** §5 says the callback admits an email when "an
  `auth_users` row already exists for it". That is wrong, and shipping it
  literally would have been a regression (AGENTS.md §12), because a row is not
  evidence an admin did anything: `@auth/drizzle-adapter` writes one after the
  first successful OAuth sign-in, and the Firebase migration wrote one for every
  account it carried over. Under a row-exists test, `ALLOWED_EMAIL_DOMAINS`
  would silently stop being able to **evict** anyone — it would only ever gate a
  first registration. That is not hypothetical: the staging cutover runbook
  records `ALLOWED_EMAIL_DOMAINS=appsilon.com` deliberately blocking two
  migrated accounts by name (`fylyps@gmail.com`, `test@crsnt.com`), and a
  row-exists test re-admits exactly those.

  So the term is `auth_users.invited_at` (migration `0048`), stamped by
  `PostgresInviteService.seedInvite` — the one path both an admin invite and a
  redeemed join link take — and settable by nothing else. §5's *intent* is
  unchanged and is what the column expresses: its own heading says "a **seeded**
  account", and seeding is precisely what a row's existence fails to witness.

  The column is **not backfilled**. Every pre-existing row keeps today's
  behaviour to the letter, so this ADR admits nobody the allowlist currently
  blocks. An external colleague invited before it shipped is already unable to
  sign in — the bug §5 exists to fix — and re-inviting them stamps the column
  and repairs it, which is an admin action and therefore the principle working
  as intended.
- **Decision 5 reached three gates, not one.** The ADR named
  `shouldSendMagicLink`; `POST /api/auth/password-login` and
  `POST /api/auth/resend-setup-link` carried the same domain term and would
  have left the same invited-external-colleague broken one route over. All
  three now apply one shared, named rule — `isSignInAuthorized({ domainAllowed,
  invited })` in `lib/email-allowlist.ts` — so a reader finds the two-term rule
  in one place instead of reconstructing it from three call sites.
  `shouldSendMagicLink` was deleted: its `userExists` term answers a different
  question (can the adapter self-register?) which its caller now asks directly,
  and its domain term became this rule.
- **What does change, named plainly.** On a deployment with
  `ALLOWED_EMAIL_DOMAINS` set, an out-of-domain address **that an admin
  deliberately seeded** can now sign in with a password, receive a magic link,
  and recover a setup link, where before all three refused. An out-of-domain
  address that merely has an account is refused exactly as it is today. An
  operator who wants a seeded person out removes the account or the membership;
  for everyone else the allowlist still evicts.
- **`max_uses` is nullable and means uncapped**, leaving the expiry as the only
  limit; the ADR listed the column without saying so. `expiresInDays` (1–90,
  default 7) is the contract's shape rather than an absolute instant, because a
  link is minted for an event.
- **Migration `0047_workspace_join_links`** carries CHECK constraints the ADR
  did not call for: `membership IN ('admin','member')` makes decision 3
  unrepresentable at rest rather than only in the contract, and
  `max_uses IS NULL OR max_uses > 0` keeps a zero-use link from being minted.
  Migration `0048_auth_users_invited_at` adds the decision-5 column above.
- **A redemption may only CREATE — it must never modify what already exists.**
  §4 reasons throughout about the redeemer's own address ("collects an email"),
  but redemption is an unauthenticated write that takes whatever is typed. Read
  literally, and routed through the `seedInvite` an admin invite uses, that
  handed any link holder three escalations this ADR never granted:

  1. **Demoting the workspace owner.** `seedInvite` upserts the membership row
     (`onConflictDoUpdate { role }`), so typing the owner's address at a link
     set their `workspace_members.role` to `member`. Reproduced against
     Postgres before the fix. It inverts decision 3 — a link that may never
     *grant* owner could nonetheless *remove* it — and it did so silently,
     because the anti-enumeration property makes the response identical either
     way.
  2. **Promoting an existing member**, back when a link could carry `admin`.
     Decision 3 has since removed that dimension entirely, but the guard stays:
     a redemption has no business rewriting a seat in either direction.
  3. **Re-admitting an allowlist-blocked account**, by stamping `invited_at`
     (the decision-5 column above) on a row that already existed — reaching
     around the very control that column was introduced to preserve.

  The fix is one rule rather than three patches, and it is what a join link
  already meant: an entrance, so walking through one twice is a no-op.
  `SeedInviteInput` carries a required `vouchedByAdmin`, with no default so a
  future third caller must choose. `inviteUser` passes `true` and keeps today's
  behaviour exactly; `redeemJoinLink` passes `false`, which restricts the seed
  to inserting — no membership rewrite in either direction, no stamp on an
  existing account, no clearing of an auto-join tombstone. A brand-new address
  is still stamped, because nobody held it and the link it arrived through was
  minted by an admin.

  What remains accepted, and is genuinely bounded: a holder can cause a
  **new** membership row plus one email for an address that is not theirs. They
  gain nothing by it — a session still requires that mailbox — and the person
  can leave.
