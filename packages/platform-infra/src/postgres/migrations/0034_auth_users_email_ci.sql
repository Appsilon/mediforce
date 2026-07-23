--> lower-case existing addresses, then make uniqueness case-insensitive.
--> Google normalises the emails it returns, so a mixed-case invite would
--> otherwise never link to the Google sign-in for the same person.
UPDATE "auth_users" SET "email" = lower("email") WHERE "email" <> lower("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_email_lower_idx" ON "auth_users" (lower("email"));
