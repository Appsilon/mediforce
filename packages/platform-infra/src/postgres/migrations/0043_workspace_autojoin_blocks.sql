-- Domain-based auto-join (AUTO_JOIN_WORKSPACES): everyone whose email is at a
-- configured domain becomes a `member` of the mapped workspace on their next
-- `GET /api/users/me`. Without a record of past removals that would make
-- `leave` and "remove member" no-ops — the user reappears on their next page
-- load — so a removal is remembered here and auto-join skips anyone listed.
--
-- A separate table rather than a `left_at` column on `workspace_members`:
-- soft-deleting the member row would oblige EVERY existing query against that
-- table to filter it out, and the one that gets missed hands a removed user
-- continued access (`getMembershipsForUser` feeds `caller.namespaces`, so a
-- miss there is an authorization hole). Nothing but the auto-join check reads
-- this table, so no existing query changes.
--
-- Written on every removal, not only in auto-join deployments: the write is
-- atomic with the removal that way, and a tombstone in a workspace that never
-- auto-joins anyone is inert.
CREATE TABLE "workspace_autojoin_blocks" (
	"workspace" text NOT NULL,
	"uid" text NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_autojoin_blocks_workspace_uid_pk" PRIMARY KEY("workspace","uid")
);--> statement-breakpoint

ALTER TABLE "workspace_autojoin_blocks" ADD CONSTRAINT "workspace_autojoin_blocks_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;
