CREATE TABLE "task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"workspace" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"blob_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachment_size_guard" CHECK (size_bytes <= 104857600)
);
--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_human_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "human_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_attachments_task_idx" ON "task_attachments" USING btree ("task_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "task_attachments_workspace_idx" ON "task_attachments" USING btree ("workspace","uploaded_at");
