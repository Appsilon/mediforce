-- ADR-0021: a join link authorizes MEMBERSHIP, not a session.
--
-- An owner/admin mints one from workspace settings and hands it to a room; the
-- holder redeems it at `/join/<token>`, which seeds an `auth_users` row + the
-- membership and emails the same one-time activation link the admin invite path
-- already sends. The token is therefore never a credential — only the mailbox
-- opens a session.
--
-- Only the SHA-256 of the token is stored: the plaintext is shown once, at
-- creation, and a database read can never reconstruct it. Deliberately NOT
-- `auth_verification_tokens` — those are single-use and bound to one
-- identifier, which is precisely what a link handed to a cohort is not.
--
-- There is no `membership` column: a join link always grants `member`
-- (ADR-0021 §3). The seat is not a dimension of the link, so it is not stored
-- as one — a link handed to a room, or photographed off a slide, must not be
-- able to confer workspace administration on whoever types an address into a
-- public form. Promoting someone stays a deliberate act by a named admin
-- (`namespace set-member-role`).
--
-- `max_uses` NULL means uncapped, leaving `expires_at` as the only limit;
-- `revoked_at` closes the entrance without touching anyone who already walked
-- through it (removal stays `namespace remove-member`).
CREATE TABLE "workspace_join_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_join_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_join_links_max_uses_check" CHECK ("max_uses" IS NULL OR "max_uses" > 0)
);--> statement-breakpoint

ALTER TABLE "workspace_join_links" ADD CONSTRAINT "workspace_join_links_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The settings list reads every link of one workspace, newest first.
CREATE INDEX "workspace_join_links_workspace_idx" ON "workspace_join_links" ("workspace");
