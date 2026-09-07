-- ADR-0021 §5, second pass: "seeded by an admin" needs its own column.
--
-- §5 relaxes the sign-in gate to "domain allowlisted OR the account already
-- exists", on the reasoning that an `auth_users` row exists only because
-- somebody deliberately created it. That reasoning is wrong for a population
-- the repo documents: `@auth/drizzle-adapter` writes an `auth_users` row after
-- the FIRST successful OAuth sign-in, and the Firebase migration wrote one for
-- every account it carried over. Both look identical to "an admin invited
-- them".
--
-- The consequence of getting this wrong is not theoretical. The staging cutover
-- runbook records `ALLOWED_EMAIL_DOMAINS=appsilon.com` deliberately blocking
-- two migrated accounts (`fylyps@gmail.com`, `test@crsnt.com`) — a row-exists
-- test would re-admit exactly those. Removing a domain from the allowlist is a
-- live operator control for evicting the people at it, and a bare existence
-- check silently retires it (AGENTS.md §12).
--
-- So the second term is this column, not the row. It is stamped by
-- `PostgresInviteService.seedInvite` — the one path an admin invite and a
-- redeemed join link both take — and by nothing else. The adapter cannot set
-- it, so a self-registered account stays evictable by domain, exactly as today.
--
-- NOT backfilled, deliberately. Every pre-existing row keeps today's behaviour
-- to the letter: nobody currently blocked by the allowlist is admitted by this
-- migration. An external colleague invited before this shipped is already
-- unable to sign in (the bug §5 exists to fix), and re-inviting them stamps the
-- column and repairs it — an admin action, which is the whole principle.
--
-- A timestamp rather than a boolean: same storage, and it answers "when were
-- they vouched for" for free, matching `revoked_at` / `blocked_at` next door.
ALTER TABLE "auth_users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "auth_users"."invited_at" IS
  'When an admin deliberately seeded this account (invite or redeemed join link). NULL = self-registered or migrated. Second term of the ADR-0021 §5 sign-in gate; never set by the Auth.js adapter.';
