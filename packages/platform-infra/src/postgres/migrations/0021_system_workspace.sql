INSERT INTO "workspaces" ("handle", "type", "display_name", "created_at", "updated_at")
VALUES ('_system', 'system', 'System', now(), now())
ON CONFLICT ("handle") DO NOTHING;
