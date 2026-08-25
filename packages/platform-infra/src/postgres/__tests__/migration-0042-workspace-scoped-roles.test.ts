import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const MIGRATION = '0042_workspace_scoped_user_roles.sql';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Migration 0042 (ADR-0019, issue #1248) is the one piece of this change that
 * runs exactly once against real production data, so it gets a test of its own
 * rather than riding on the repository contract.
 *
 * Two things it has to get right, both invisible when wrong:
 *
 *  - **Backfill.** Every deployment-global grant fans out across the
 *    namespaces its holder belongs to. A role holder who is a member of the
 *    run's workspace must keep every notification they get today — ADR-0019
 *    names this the thing #1248 must prove. A holder who is *not* a member
 *    stops being notified, which is an accepted regression, not an oversight.
 *  - **Seed.** `user_roles` is empty in every deployment while workflow
 *    definitions already declare `allowedRoles`, so without a seed the role
 *    gate (#1249) lands on a table with no holders and strands every gated
 *    step. The grants go to owner/admin and are recorded as an audit event.
 *
 * The setup applies migrations 0000…0041 to reach the pre-0042 world, seeds
 * it, and then applies 0042 alone.
 */
describe.skipIf(skipPg)('migration 0042 — workspace-scoped user roles', () => {
  const schemaName = `mig42_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    sql = postgres(DATABASE_URL!, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const upToDate = files.slice(0, files.indexOf(MIGRATION));
    expect(files).toContain(MIGRATION);
    for (const file of upToDate) {
      await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }

    await sql`
      INSERT INTO workspaces (handle, type, display_name)
      VALUES ('ws-a', 'organization', 'A'), ('ws-b', 'organization', 'B')
    `;
    await sql`
      INSERT INTO auth_users (id, email) VALUES
        ('alice', 'alice@x.com'),
        ('bob', 'bob@x.com'),
        ('carol', 'carol@x.com')
    `;
    await sql`
      INSERT INTO workspace_members (workspace, uid, role) VALUES
        ('ws-a', 'carol', 'owner'),
        ('ws-a', 'alice', 'member'),
        ('ws-b', 'alice', 'member')
    `;
    // The pre-0042 world: deployment-global grants, no namespace anywhere.
    // Bob holds `reviewer` and belongs to no workspace at all.
    await sql`
      INSERT INTO user_roles (uid, role) VALUES
        ('alice', 'reviewer'),
        ('bob', 'reviewer')
    `;
    // One live workflow declaring roles on its steps, one deleted one whose
    // declarations must not be seeded from.
    await sql`
      INSERT INTO workflow_definitions (workspace, name, version, steps, transitions, deleted_at)
      VALUES
        ('ws-a', 'tealflow', 1, ${sql.json([
          { id: 'review', allowedRoles: ['biostatistician', 'reviewer'] },
          { id: 'sign', allowedRoles: [] },
          { id: 'notes' },
        ])}, ${sql.json([])}, NULL),
        ('ws-a', 'deadflow', 1, ${sql.json([
          { id: 'gone', allowedRoles: ['ghost'] },
        ])}, ${sql.json([])}, now())
    `;

    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));
  });

  afterAll(async () => {
    if (sql) await sql.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  async function grantsFor(uid: string): Promise<Array<{ role: string; namespace: string; workflowName: string | null }>> {
    const rows = await sql<{ role: string; namespace: string; workflow_name: string | null }[]>`
      SELECT role, namespace, workflow_name FROM user_roles WHERE uid = ${uid}
      ORDER BY namespace, role, workflow_name NULLS FIRST
    `;
    return rows.map((row) => ({
      role: row.role,
      namespace: row.namespace,
      workflowName: row.workflow_name,
    }));
  }

  it('fans a global grant across every workspace its holder belongs to', async () => {
    expect(await grantsFor('alice')).toEqual([
      { role: 'reviewer', namespace: 'ws-a', workflowName: null },
      { role: 'reviewer', namespace: 'ws-b', workflowName: null },
    ]);
  });

  it('drops a global grant held by someone who belongs to no workspace', async () => {
    // The accepted regression (ADR-0019): today's global query happily emails
    // Bob about runs in workspaces he cannot open. After this it does not.
    expect(await grantsFor('bob')).toEqual([]);
  });

  it('seeds the roles a live workflow declares to the workspace owner', async () => {
    expect(await grantsFor('carol')).toEqual([
      { role: 'biostatistician', namespace: 'ws-a', workflowName: null },
      { role: 'reviewer', namespace: 'ws-a', workflowName: null },
    ]);
  });

  it('does not seed from a deleted workflow, or to a plain member', async () => {
    const ghosts = await sql`SELECT 1 FROM user_roles WHERE role = 'ghost'`;
    expect(ghosts).toHaveLength(0);
    // Alice is a `member` of ws-a, so the seed passes her over; her only grants
    // are the two backfilled ones asserted above.
    expect(await grantsFor('alice')).toHaveLength(2);
  });

  it('records the seeded grants as an audit event on the workspace', async () => {
    const rows = await sql<{ workspace: string; payload: { outputSnapshot: { roles: string[]; uids: string[] } } }[]>`
      SELECT workspace, payload FROM audit_events
      WHERE action = 'namespace.member_roles_seeded'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace).toBe('ws-a');
    expect([...rows[0]!.payload.outputSnapshot.roles].sort()).toEqual([
      'biostatistician',
      'reviewer',
    ]);
    expect(rows[0]?.payload.outputSnapshot.uids).toEqual(['carol']);
  });

  // Uniqueness is exercised on Bob, who the backfill left with no rows, so
  // these two cases cannot perturb the assertions above.
  it('treats two workspace-wide grants of the same role as one row', async () => {
    await sql`INSERT INTO user_roles (uid, role, namespace, workflow_name) VALUES ('bob', 'operator', 'ws-a', NULL)`;
    // `UNIQUE NULLS NOT DISTINCT` is what makes the repeat a conflict; a plain
    // UNIQUE would treat every NULL as distinct and let duplicates pile up.
    await expect(
      sql`INSERT INTO user_roles (uid, role, namespace, workflow_name) VALUES ('bob', 'operator', 'ws-a', NULL)`,
    ).rejects.toThrow(/duplicate key/);
  });

  it('allows the same role narrowed to a workflow alongside the workspace-wide grant', async () => {
    await sql`INSERT INTO user_roles (uid, role, namespace, workflow_name) VALUES ('bob', 'operator', 'ws-a', 'tealflow')`;
    expect(await grantsFor('bob')).toEqual([
      { role: 'operator', namespace: 'ws-a', workflowName: null },
      { role: 'operator', namespace: 'ws-a', workflowName: 'tealflow' },
    ]);
  });
});
