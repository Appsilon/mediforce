-- Standing instructions one person keeps for the workflow designer's AI
-- assistant in one workspace: the extra system prompt that says how *they* want
-- workflows built (naming, house defaults, the step shapes they always reach
-- for).
--
-- Read server-side on every assistant turn rather than sent with the request,
-- so it holds for a whole session, survives a reload, and is still there the
-- next morning — and no client can inject text into the system prompt.
--
-- Its own table, not a column on `workspace_members`: that row is handed to
-- every member by the member list, and this text is private to its author.
-- `(workspace, uid)` is the grain — the same person keeps different conventions
-- in different workspaces. No FK on `uid`, matching `workspace_members`.
CREATE TABLE "workflow_assistant_instructions" (
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "uid" text NOT NULL,
  "instructions" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_assistant_instructions_workspace_uid_pk" PRIMARY KEY("workspace","uid")
);--> statement-breakpoint

COMMENT ON TABLE "workflow_assistant_instructions" IS
  'Per-(workspace, user) extra system prompt for the workflow designer AI assistant. Private to the uid that wrote it; cleared by deleting the row.';
