CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"uid" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "user_roles_uid_role_pk" PRIMARY KEY("uid","role")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_uid_auth_users_id_fk" FOREIGN KEY ("uid") REFERENCES "auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role");--> statement-breakpoint
CREATE TRIGGER auth_users_set_updated_at
	BEFORE UPDATE ON "auth_users"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
