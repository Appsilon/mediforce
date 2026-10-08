import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const MIGRATION = '0077_tool_catalog_http_entries.sql';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

type AgentRow = { id: string; mcp_servers: Record<string, Record<string, unknown>> };
type CatalogRow = { workspace: string; id: string; type: string; url: string | null; auth: unknown };

/**
 * Migration 0077 moves every inline HTTP MCP binding into the workspace tool
 * catalog and rewrites the binding to reference it. It runs once against real
 * agents, so it gets its own test: applies 0000…0076, seeds agents in the
 * pre-0077 shape, then applies 0077 alone.
 */
describe.skipIf(skipPg)('migration 0077 — HTTP MCP servers move into the tool catalog', () => {
  const schemaName = `mig77_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;

  const agent = (id: string, namespace: string, mcpServers: Record<string, unknown>) => sql`
    INSERT INTO agents (id, namespace, name, icon_name, description, foundation_model,
      system_prompt, input_description, output_description, mcp_servers)
    VALUES (${id}, ${namespace}, ${id}, 'bot', '', 'sonnet', '', '', '', ${sql.json(mcpServers as never)})
  `;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    sql = postgres(DATABASE_URL!, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(MIGRATION);
    for (const file of files.slice(0, files.indexOf(MIGRATION))) {
      await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }

    // An existing stdio entry whose id collides with a host slug.
    await sql`
      INSERT INTO tool_catalog_entries (workspace, id, command)
      VALUES ('ws-a', 'api-github-com', 'gh-mcp')
    `;
    await agent('agent-1', 'ws-a', {
      fs: { type: 'stdio', catalogId: 'filesystem' },
      github: {
        type: 'http',
        url: 'https://api.github.com/mcp',
        allowedTools: ['search_code'],
        auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' },
      },
      legacy: {
        type: 'http',
        url: 'https://mcp.example.com/v1',
        auth: { headers: { Authorization: 'Bearer {{SECRET:tok}}' } },
      },
    });
    // Same url + auth as agent-1's github binding → reuses its entry.
    await agent('agent-2', 'ws-a', {
      gh: {
        type: 'http',
        url: 'https://api.github.com/mcp',
        auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' },
      },
      open: { type: 'http', url: 'https://mcp.example.com/v1', auth: {} },
    });
    // Same url in another workspace → its own entry there.
    await agent('agent-3', 'ws-b', { gh: { type: 'http', url: 'https://api.github.com/mcp' } });

    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));
  });

  afterAll(async () => {
    if (sql) await sql.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  const agents = async () =>
    Object.fromEntries(
      (await sql<AgentRow[]>`SELECT id, mcp_servers FROM agents ORDER BY id`).map((row) => [row.id, row.mcp_servers]),
    );
  const catalog = () =>
    sql<CatalogRow[]>`SELECT workspace, id, type, url, auth FROM tool_catalog_entries ORDER BY workspace, id`;

  it('rewrites inline HTTP bindings to catalog references and leaves stdio bindings alone', async () => {
    const byId = await agents();
    expect(byId['agent-1']).toEqual({
      fs: { type: 'stdio', catalogId: 'filesystem' },
      github: { type: 'http', catalogId: 'api-github-com-2', allowedTools: ['search_code'] },
      legacy: { type: 'http', catalogId: 'mcp-example-com' },
    });
    expect(byId['agent-2']).toEqual({
      gh: { type: 'http', catalogId: 'api-github-com-2' },
      open: { type: 'http', catalogId: 'mcp-example-com-2' },
    });
    expect(byId['agent-3']).toEqual({ gh: { type: 'http', catalogId: 'api-github-com' } });
  });

  it('creates one http entry per distinct url + auth in each workspace', async () => {
    expect(await catalog()).toEqual([
      { workspace: 'ws-a', id: 'api-github-com', type: 'stdio', url: null, auth: null },
      {
        workspace: 'ws-a',
        id: 'api-github-com-2',
        type: 'http',
        url: 'https://api.github.com/mcp',
        auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' },
      },
      {
        workspace: 'ws-a',
        id: 'mcp-example-com',
        type: 'http',
        url: 'https://mcp.example.com/v1',
        auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:tok}}' } },
      },
      { workspace: 'ws-a', id: 'mcp-example-com-2', type: 'http', url: 'https://mcp.example.com/v1', auth: null },
      { workspace: 'ws-b', id: 'api-github-com', type: 'http', url: 'https://api.github.com/mcp', auth: null },
    ]);
  });

  it('is idempotent', async () => {
    const before = { agents: await agents(), catalog: await catalog() };
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf-8').split('--> statement-breakpoint').pop()!);
    expect({ agents: await agents(), catalog: await catalog() }).toEqual(before);
  });
});
