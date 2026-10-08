-- The tool catalog holds HTTP MCP servers too, and an agent's HTTP binding
-- references a catalog entry by id instead of carrying its own url/auth.
--
-- 1. Catalog rows gain `type` (existing rows are stdio), `url` and `auth`;
--    `command` becomes nullable because http rows have none.
-- 2. Every inline HTTP binding `{ type: 'http', url, auth?, allowedTools? }`
--    on an agent becomes `{ type: 'http', catalogId, allowedTools? }`. The
--    url/auth move to an http catalog entry in the agent's workspace — an
--    existing entry with the same url and auth is reused, otherwise a new
--    one is created with an id slugged from the url's host (suffixed -2, -3…
--    on collision). Legacy `{ headers }` auth (no `type`) is normalised to
--    `{ type: 'headers', headers }`; an empty `{}` auth is dropped.
--
-- The binding name (the mcp_servers key) is unchanged, so OAuth tokens keyed
-- by (agent, server name) keep resolving. Idempotent: migrated bindings carry
-- no `url` and match nothing.
--
-- An agent with no workspace (namespace and workspace both null) has no
-- catalog to move its binding into; the migration fails loudly rather than
-- dropping the binding.

ALTER TABLE "tool_catalog_entries" ADD COLUMN "type" text DEFAULT 'stdio' NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ALTER COLUMN "command" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ADD COLUMN "auth" jsonb;--> statement-breakpoint
DO $$
DECLARE
  agent_row record;
  binding_name text;
  binding jsonb;
  next_servers jsonb;
  target_workspace text;
  normalized_auth jsonb;
  entry_id text;
  base_id text;
  suffix int;
BEGIN
  FOR agent_row IN
    SELECT "id", "namespace", "workspace", "mcp_servers"
    FROM "agents"
    WHERE "mcp_servers" IS NOT NULL
      AND jsonb_typeof("mcp_servers") = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each("mcp_servers") AS server(name, value)
        WHERE server.value->>'type' = 'http' AND server.value ? 'url'
      )
  LOOP
    target_workspace := COALESCE(agent_row."namespace", agent_row."workspace");
    IF target_workspace IS NULL THEN
      RAISE EXCEPTION 'Agent % has inline HTTP MCP bindings but no workspace to hold their catalog entries', agent_row."id";
    END IF;

    next_servers := agent_row."mcp_servers";
    FOR binding_name, binding IN SELECT server.name, server.value FROM jsonb_each(agent_row."mcp_servers") AS server(name, value)
    LOOP
      CONTINUE WHEN binding->>'type' IS DISTINCT FROM 'http' OR NOT (binding ? 'url');

      normalized_auth := CASE
        WHEN jsonb_typeof(binding->'auth') IS DISTINCT FROM 'object' THEN NULL
        WHEN binding->'auth' ? 'type' THEN binding->'auth'
        WHEN jsonb_typeof(binding->'auth'->'headers') = 'object'
          THEN jsonb_build_object('type', 'headers', 'headers', binding->'auth'->'headers')
        ELSE NULL
      END;

      SELECT "id" INTO entry_id
      FROM "tool_catalog_entries"
      WHERE "workspace" = target_workspace
        AND "type" = 'http'
        AND "url" = binding->>'url'
        AND "auth" IS NOT DISTINCT FROM normalized_auth
      ORDER BY "id"
      LIMIT 1;

      IF entry_id IS NULL THEN
        base_id := trim(BOTH '-' FROM regexp_replace(
          lower(COALESCE(substring(binding->>'url' FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)'), '')),
          '[^a-z0-9]+', '-', 'g'
        ));
        IF base_id = '' THEN base_id := 'mcp'; END IF;
        entry_id := base_id;
        suffix := 2;
        WHILE EXISTS (
          SELECT 1 FROM "tool_catalog_entries"
          WHERE "workspace" = target_workspace AND "id" = entry_id
        ) LOOP
          entry_id := base_id || '-' || suffix;
          suffix := suffix + 1;
        END LOOP;

        INSERT INTO "tool_catalog_entries" ("workspace", "id", "type", "url", "auth")
        VALUES (target_workspace, entry_id, 'http', binding->>'url', normalized_auth);
      END IF;

      next_servers := jsonb_set(
        next_servers,
        ARRAY[binding_name],
        jsonb_build_object('type', 'http', 'catalogId', entry_id)
          || CASE WHEN binding ? 'allowedTools'
               THEN jsonb_build_object('allowedTools', binding->'allowedTools')
               ELSE '{}'::jsonb
             END
      );
      entry_id := NULL;
    END LOOP;

    UPDATE "agents" SET "mcp_servers" = next_servers WHERE "id" = agent_row."id";
  END LOOP;
END $$;
