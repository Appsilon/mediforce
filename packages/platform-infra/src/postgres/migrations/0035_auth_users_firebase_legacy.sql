-- ADR-0002 Gap 2 — migrate-on-login for Firebase password users.
-- Firebase scrypt hashes cannot be converted to bcrypt, but they CAN be
-- verified at sign-in and then rehashed to bcrypt on first success
-- (packages/platform-infra/src/auth/firebase-scrypt.ts). These two columns
-- hold the per-user Firebase credential carried over by the seed; they are
-- cleared the moment the user's plaintext is rehashed into `password_hash`.
ALTER TABLE "auth_users" ADD COLUMN "firebase_password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "firebase_salt" text;
