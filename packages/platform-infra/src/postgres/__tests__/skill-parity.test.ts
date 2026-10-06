import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileTreeBytes, type SkillRepository, type SkillWrite } from '@mediforce/platform-core';
import { InMemorySkillRepository } from '@mediforce/platform-core/testing';
import { PostgresSkillRepository } from '../repositories/skill-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const skillMd = '---\nname: sdtm-mapping\ndescription: Map raw data to SDTM\n---\n# SDTM\n';

/**
 * Shared contract for SkillRepository (ADR-0001 L2 parity).
 * Both the in-memory double and the Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<SkillRepository>) {
  describe(`${name} — SkillRepository contract`, () => {
    let repo: SkillRepository;
    const all = { publicOnly: false };

    beforeEach(async () => {
      repo = await factory();
    });

    const skill = (overrides: Partial<SkillWrite> = {}): SkillWrite => ({
      namespace: 'appsilon',
      id: 'sdtm-mapping',
      name: 'sdtm-mapping',
      description: 'Map raw data to SDTM',
      visibility: 'private',
      contentHash: 'hash-1',
      files: [
        { path: 'SKILL.md', contents: skillMd },
        { path: 'references/domains.md', contents: '# DM, AE — Grade 5 = death\n' },
      ],
      ...overrides,
    });

    it('returns null for getById when the skill is absent', async () => {
      expect(await repo.getById('appsilon', 'missing', all)).toBeNull();
    });

    it('create then getById round-trips every file unchanged', async () => {
      const written = await repo.create(skill());
      const got = await repo.getById('appsilon', 'sdtm-mapping', all);
      expect(got).toEqual(written);
      expect(got?.files).toEqual(skill().files);
      expect(typeof got?.createdAt).toBe('string');
    });

    it('update replaces an existing skill and keeps createdAt', async () => {
      const first = await repo.create(skill());
      await repo.update(skill({ contentHash: 'hash-2', visibility: 'public', files: [{ path: 'SKILL.md', contents: skillMd }] }));
      const got = await repo.getById('appsilon', 'sdtm-mapping', all);
      expect(got?.contentHash).toBe('hash-2');
      expect(got?.visibility).toBe('public');
      expect(got?.files).toHaveLength(1);
      expect(got?.createdAt).toBe(first?.createdAt);
    });

    it('create inserts once and returns null when the id is taken, leaving the first write', async () => {
      const first = await repo.create(skill());
      expect(first?.files).toEqual(skill().files);
      expect(await repo.create(skill({ contentHash: 'hash-2' }))).toBeNull();
      expect((await repo.getById('appsilon', 'sdtm-mapping', all))?.contentHash).toBe('hash-1');
    });

    it('list returns summaries with paths, ordered by id, scoped to the namespace', async () => {
      const other = '---\nname: ae-grading\ndescription: Grade AEs\n---\n';
      await repo.create(skill());
      await repo.create(skill({ id: 'ae-grading', name: 'ae-grading', files: [{ path: 'SKILL.md', contents: other }] }));
      await repo.create(skill({ namespace: 'other-ws' }));
      const listed = await repo.list('appsilon', all);
      expect(listed.map((summary) => summary.id)).toEqual(['ae-grading', 'sdtm-mapping']);
      expect(listed[1]?.paths).toEqual(['SKILL.md', 'references/domains.md']);
      expect(listed[1]?.size).toBe(fileTreeBytes(skill().files));
      expect(listed[1]).not.toHaveProperty('files');
    });

    it('update returns null and writes nothing when the skill is absent', async () => {
      expect(await repo.update(skill())).toBeNull();
      expect(await repo.getById('appsilon', 'sdtm-mapping', all)).toBeNull();
    });

    it('publicOnly hides private skills from getById and list', async () => {
      await repo.create(skill());
      await repo.create(skill({ id: 'ae-grading', name: 'ae-grading', visibility: 'public' }));
      const publicOnly = { publicOnly: true };
      expect(await repo.getById('appsilon', 'sdtm-mapping', publicOnly)).toBeNull();
      expect((await repo.getById('appsilon', 'ae-grading', publicOnly))?.id).toBe('ae-grading');
      expect((await repo.list('appsilon', publicOnly)).map((summary) => summary.id)).toEqual(['ae-grading']);
    });

    it('listPublic returns public skills of every namespace, ordered by namespace then id', async () => {
      await repo.create(skill());
      await repo.create(skill({ id: 'ae-grading', name: 'ae-grading', visibility: 'public' }));
      await repo.create(skill({ namespace: 'other-ws', id: 'adam-derivation', name: 'adam-derivation', visibility: 'public' }));
      await repo.create(skill({ namespace: 'other-ws', id: 'zz-private', name: 'zz-private' }));
      const listed = await repo.listPublic();
      expect(listed.map((summary) => `${summary.namespace}/${summary.id}`)).toEqual([
        'appsilon/ae-grading',
        'other-ws/adam-derivation',
      ]);
      expect(listed[0]?.paths).toEqual(['SKILL.md', 'references/domains.md']);
    });

    it('delete removes the skill and is a no-op when absent', async () => {
      await repo.create(skill());
      await repo.delete('appsilon', 'sdtm-mapping');
      await repo.delete('appsilon', 'sdtm-mapping');
      expect(await repo.getById('appsilon', 'sdtm-mapping', all)).toBeNull();
    });

    it('rejects a write whose files have no SKILL.md', async () => {
      await expect(repo.create(skill({ files: [{ path: 'README.md', contents: '' }] }))).rejects.toThrow();
    });
  });
}

contract('InMemorySkillRepository', async () => new InMemorySkillRepository());

describe.skipIf(skipPg)('PostgresSkillRepository (parity)', () => {
  const schemaName = `sk_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    testClient = postgres(DATABASE_URL!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await testClient.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    // `skills.workspace` references `workspaces.handle`.
    await testClient.unsafe(`
      INSERT INTO workspaces (handle, type, display_name)
      VALUES ('appsilon', 'organization', 'Appsilon'),
             ('other-ws', 'organization', 'Other')
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresSkillRepository', async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."skills"`);
    return new PostgresSkillRepository(drizzle(testClient, { schema }));
  });
});
