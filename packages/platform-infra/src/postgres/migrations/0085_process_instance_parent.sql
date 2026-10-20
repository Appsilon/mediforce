-- A run a `spawn` step fired records its parent, so a `wait` condition can
-- join on its children (`children.allFinished`). The Zod schema
-- has carried `parentInstanceId` since spawn shipped; Postgres never stored it.
--
-- Additive and nullable: runs not fired by a spawn have no parent. Children
-- spawned before this migration stay unlinked — a wait already parked on them
-- sees zero children and resolves on its next sweep.
ALTER TABLE "process_instances" ADD COLUMN "parent_instance_id" text;--> statement-breakpoint
ALTER TABLE "process_instances" ADD COLUMN "parent_definition_name" text;--> statement-breakpoint
CREATE INDEX "process_instances_parent_instance_idx" ON "process_instances" USING btree ("parent_instance_id") WHERE "process_instances"."parent_instance_id" is not null;
