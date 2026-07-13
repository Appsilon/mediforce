CREATE TABLE "cron_trigger_state" (
	"definition_name" text NOT NULL,
	"trigger_name" text NOT NULL,
	"last_triggered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cron_trigger_state_definition_name_trigger_name_pk" PRIMARY KEY("definition_name","trigger_name")
);
