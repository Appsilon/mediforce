import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const MIGRATION = '0079_retire_file_skills.sql';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

type Step = Record<string, unknown> & { id: string };

const EXT = { url: 'https://github.com/acme/skills.git', commit: 'a'.repeat(40), auth: 'GITHUB_TOKEN' };

/**
 * Migration 0079 retires workflow-file skills and `externalSkillsRepo`. It runs
 * once against stored versions, which cannot be re-saved, so it gets its own
 * test: applies 0000…0078, seeds versions in the pre-0079 shape, then applies
 * 0079 alone.
 */
describe.skipIf(skipPg)('migration 0079 — file skills and externalSkillsRepo retire', () => {
  const schemaName = `mig79_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;

  const version = (name: string, steps: Step[], ext: unknown, artifacts: unknown = null) => sql`
    INSERT INTO workflow_definitions (workspace, name, version, steps, transitions, external_skills_repo, artifacts)
    VALUES ('ws-a', ${name}, 1, ${sql.json(steps as never)}, ${sql.json([] as never)},
      ${ext === null ? null : sql.json(ext as never)}, ${artifacts === null ? null : sql.json(artifacts as never)})
  `;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    sql = postgres(DATABASE_URL!, { max: 1, onnotice: () => {}, connection: { search_path: schemaName } });

    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
    expect(files).toContain(MIGRATION);
    for (const file of files.slice(0, files.indexOf(MIGRATION))) {
      await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    await sql`INSERT INTO workspaces (handle, type, display_name) VALUES ('ws-a', 'team', 'A')`;

    await version('file-skills', [
      { id: 'named', agent: { skill: 'summarize', skillsDir: 'apps/x/skills/', prompt: 'Go.' } },
      { id: 'folder-only', agent: { skillsDir: 'skills' } },
      { id: 'unread-skill', agent: { skill: 'ignored', prompt: 'Go.' } },
      { id: 'catalog', agent: { prompt: 'Go.', skills: [{ namespace: 'ws-a', id: 'summarize' }] } },
      { id: 'human' },
    ], null);
    await version('build-fallback', [
      { id: 'agent-build', agent: { dockerfile: 'container/Dockerfile', prompt: 'Go.' } },
      { id: 'script-build', script: { dockerfile: './container/Dockerfile', command: 'run' } },
      { id: 'own-repo', agent: { dockerfile: 'Dockerfile', repo: 'https://github.com/acme/app', commit: 'b'.repeat(40), prompt: 'Go.' } },
      { id: 'own-auth', agent: { dockerfile: 'Dockerfile', repo: 'https://github.com/acme/app', commit: 'b'.repeat(40), repoAuth: 'MINE', prompt: 'Go.' } },
      { id: 'carried', agent: { dockerfile: 'carried/Dockerfile', prompt: 'Go.' } },
      { id: 'carried-spelled', agent: { dockerfile: '/carried/./sub/../Dockerfile', prompt: 'Go.' } },
      { id: 'prebuilt', agent: { image: 'mediforce-golden-image', prompt: 'Go.' } },
    ], EXT, [{ path: 'carried/Dockerfile', contents: 'FROM r-base\n' }]);

    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));
  });

  afterAll(async () => {
    if (sql) await sql.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  const steps = async (name: string): Promise<Record<string, Step>> => {
    const [row] = await sql<{ steps: Step[] }[]>`SELECT steps FROM workflow_definitions WHERE name = ${name}`;
    return Object.fromEntries((row?.steps ?? []).map((step) => [step.id, step]));
  };

  it('records a file skill the runtime read as retiredFileSkill and drops the old keys', async () => {
    const byId = await steps('file-skills');
    expect(byId.named?.agent).toEqual({ prompt: 'Go.', retiredFileSkill: 'apps/x/skills/summarize' });
    expect(byId['folder-only']?.agent).toEqual({ retiredFileSkill: 'skills' });
    expect(byId['unread-skill']?.agent).toEqual({ prompt: 'Go.' });
    expect(byId.catalog?.agent).toEqual({ prompt: 'Go.', skills: [{ namespace: 'ws-a', id: 'summarize' }] });
    expect(byId.human).toEqual({ id: 'human' });
  });

  it('writes the externalSkillsRepo build source onto the steps that built from it', async () => {
    const byId = await steps('build-fallback');
    expect(byId['agent-build']?.agent).toEqual({
      dockerfile: 'container/Dockerfile', prompt: 'Go.', repo: EXT.url, commit: EXT.commit, repoAuth: 'GITHUB_TOKEN',
    });
    expect(byId['script-build']?.script).toEqual({
      dockerfile: './container/Dockerfile', command: 'run', repo: EXT.url, commit: EXT.commit, repoAuth: 'GITHUB_TOKEN',
    });
    expect(byId['own-repo']?.agent).toMatchObject({ repo: 'https://github.com/acme/app', repoAuth: 'GITHUB_TOKEN' });
    expect(byId['own-auth']?.agent).toMatchObject({ repo: 'https://github.com/acme/app', repoAuth: 'MINE' });
    expect(byId.carried?.agent).toEqual({ dockerfile: 'carried/Dockerfile', prompt: 'Go.' });
    expect(byId['carried-spelled']?.agent).toEqual({ dockerfile: '/carried/./sub/../Dockerfile', prompt: 'Go.' });
    expect(byId.prebuilt?.agent).toEqual({ image: 'mediforce-golden-image', prompt: 'Go.' });
  });

  it('drops the external_skills_repo column', async () => {
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schemaName} AND table_name = 'workflow_definitions'
    `;
    expect(columns.map((column) => column.column_name)).not.toContain('external_skills_repo');
  });
});
