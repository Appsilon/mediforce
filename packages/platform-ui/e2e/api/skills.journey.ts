import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect } from '../helpers/test-fixtures';
import {
  OUTSIDER_NAMESPACE,
  TEST_ORG_HANDLE,
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API journey for the Skill Catalog (ADR-0025, #1460). Runs against
 * Postgres: route handler → AuthorizedSkillRepository →
 * PostgresSkillRepository → live Postgres. The create goes through the real
 * `mediforce skill create --from <dir>` binary, which is the upload path a
 * developer uses.
 */

const CLI_BIN = resolve(__dirname, '..', '..', '..', 'cli', 'bin', 'mediforce.cjs');

interface SkillFileBody {
  path: string;
  contents: string;
}

interface SkillBody {
  namespace: string;
  id: string;
  name: string;
  description: string;
  visibility: 'private' | 'public';
  contentHash: string;
  files: SkillFileBody[];
}

function writeSkillFolder(name: string): { dir: string; files: SkillFileBody[] } {
  const dir = join(mkdtempSync(join(tmpdir(), 'skill-journey-')), name);
  const files: SkillFileBody[] = [
    { path: 'SKILL.md', contents: `---\nname: ${name}\ndescription: Map raw clinical data to SDTM domains\n---\n# SDTM mapping\nSee references/domains.md.\n` },
    { path: 'references/domains.md', contents: '# Domains\n- DM\n- AE (CTCAE grade 1–5; Grade 5 = death)\n' },
    { path: 'scripts/check.py', contents: 'print("ok")\n' },
  ];
  for (const file of files) {
    mkdirSync(join(dir, file.path, '..'), { recursive: true });
    writeFileSync(join(dir, file.path), file.contents);
  }
  return { dir, files };
}

function cli(baseURL: string, args: string[]): string {
  return execFileSync(process.execPath, [CLI_BIN, ...args, '--base-url', baseURL, '--json'], {
    env: { ...process.env, MEDIFORCE_API_KEY: process.env.PLATFORM_API_KEY ?? 'test-api-key' },
    stdio: 'pipe',
  }).toString();
}

test.describe('skills API journey', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('a folder created through the CLI lists and reads back with every file unchanged', async ({ request, baseURL }) => {
    if (baseURL === undefined) throw new Error('Playwright baseURL is not configured');
    const name = `e2e-skill-${Date.now()}`;
    const { dir, files } = writeSkillFolder(name);

    const created = JSON.parse(cli(baseURL, ['skill', 'create', '--from', dir, '--namespace', TEST_ORG_HANDLE])) as { skill: SkillBody };
    expect(created.skill).toMatchObject({
      namespace: TEST_ORG_HANDLE,
      id: name,
      name,
      description: 'Map raw clinical data to SDTM domains',
      visibility: 'private',
    });

    const listRes = await request.get(`/api/skills?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders() });
    expect(listRes.ok(), await listRes.text()).toBe(true);
    const list = (await listRes.json()) as { skills: Array<{ id: string; paths: string[] }> };
    expect(list.skills.find((skill) => skill.id === name)?.paths).toEqual(files.map((file) => file.path));

    const getRes = await request.get(`/api/skills/${name}?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders() });
    expect(getRes.ok(), await getRes.text()).toBe(true);
    const { skill } = (await getRes.json()) as { skill: SkillBody };
    expect(skill.files).toEqual(files);
    expect(skill.contentHash).toBe(created.skill.contentHash);

    const duplicate = await request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders(), data: { files } });
    expect(duplicate.status()).toBe(409);

    const renamed = await request.patch(`/api/skills/${name}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
      data: { files: [{ path: 'SKILL.md', contents: '---\nname: another-name\ndescription: x\n---\n' }] },
    });
    expect(renamed.status(), await renamed.text()).toBe(400);

    const deleteRes = await request.delete(`/api/skills/${name}?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders() });
    expect(deleteRes.ok(), await deleteRes.text()).toBe(true);
    const gone = await request.get(`/api/skills/${name}?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders() });
    expect(gone.status()).toBe(404);
  });

  test('the contract refuses a skill without SKILL.md, a bad path, an oversized set, and a client-sent name', async ({ request }) => {
    const skillMd = { path: 'SKILL.md', contents: '---\nname: e2e-bad\ndescription: x\n---\n' };
    const post = (data: unknown) => request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders(), data });

    expect((await post({ files: [{ path: 'README.md', contents: '' }] })).status()).toBe(400);
    expect((await post({ files: [skillMd, { path: '../escape.md', contents: '' }] })).status()).toBe(400);
    const big = Array.from({ length: 5 }, (_, index) => ({ path: `references/${String(index)}.md`, contents: 'x'.repeat(60 * 1024) }));
    expect((await post({ files: [skillMd, ...big] })).status()).toBe(400);
    expect((await post({ files: [skillMd], name: 'e2e-bad' })).status()).toBe(400);
  });

  test('a caller from another workspace sees only public skills and can write none', async ({ request }) => {
    const member = sessionCookieHeaders(callers.member);
    const outsider = sessionCookieHeaders(callers.outsider);
    const stamp = Date.now();
    const privateName = `e2e-private-${stamp}`;
    const publicName = `e2e-public-${stamp}`;
    const skillFiles = (name: string) => [{ path: 'SKILL.md', contents: `---\nname: ${name}\ndescription: Grade AEs by CTCAE\n---\n` }];

    for (const [name, visibility] of [[privateName, 'private'], [publicName, 'public']] as const) {
      const res = await request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, { headers: member, data: { files: skillFiles(name), visibility } });
      expect(res.status(), await res.text()).toBe(201);
    }

    const listRes = await request.get(`/api/skills?namespace=${TEST_ORG_HANDLE}`, { headers: outsider });
    const ids = ((await listRes.json()) as { skills: Array<{ id: string }> }).skills.map((skill) => skill.id);
    expect(ids).toContain(publicName);
    expect(ids).not.toContain(privateName);

    const readPublic = await request.get(`/api/skills/${publicName}?namespace=${TEST_ORG_HANDLE}`, { headers: outsider });
    expect(readPublic.ok(), await readPublic.text()).toBe(true);
    expect((await request.get(`/api/skills/${privateName}?namespace=${TEST_ORG_HANDLE}`, { headers: outsider })).status()).toBe(404);

    const create = await request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, { headers: outsider, data: { files: skillFiles(`e2e-intruder-${stamp}`) } });
    expect(create.status()).toBe(403);
    const flip = await request.patch(`/api/skills/${publicName}?namespace=${TEST_ORG_HANDLE}`, { headers: outsider, data: { visibility: 'private' } });
    expect(flip.status()).toBe(403);
    const remove = await request.delete(`/api/skills/${publicName}?namespace=${TEST_ORG_HANDLE}`, { headers: outsider });
    expect(remove.status()).toBe(403);

    // The outsider's own workspace is theirs to write.
    const own = await request.post(`/api/skills?namespace=${OUTSIDER_NAMESPACE}`, { headers: outsider, data: { files: skillFiles(publicName) } });
    expect(own.status(), await own.text()).toBe(201);

    for (const [namespace, name, headers] of [
      [TEST_ORG_HANDLE, privateName, member],
      [TEST_ORG_HANDLE, publicName, member],
      [OUTSIDER_NAMESPACE, publicName, outsider],
    ] as const) {
      await request.delete(`/api/skills/${name}?namespace=${namespace}`, { headers });
    }
  });
});
