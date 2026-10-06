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

  test('an agent holds skills it may reach, and a held skill cannot be deleted or made private', async ({ request, baseURL }) => {
    if (baseURL === undefined) throw new Error('Playwright baseURL is not configured');
    const member = sessionCookieHeaders(callers.member);
    const outsider = sessionCookieHeaders(callers.outsider);
    const stamp = Date.now();
    const ownPrivate = `e2e-own-private-${stamp}`;
    const otherPrivate = `e2e-other-private-${stamp}`;
    const otherPublic = `e2e-other-public-${stamp}`;
    const skillFiles = (name: string) => [{ path: 'SKILL.md', contents: `---\nname: ${name}\ndescription: Derive ADaM ADSL\n---\n` }];

    for (const [namespace, name, visibility, headers] of [
      [TEST_ORG_HANDLE, ownPrivate, 'private', member],
      [OUTSIDER_NAMESPACE, otherPrivate, 'private', outsider],
      [OUTSIDER_NAMESPACE, otherPublic, 'public', outsider],
    ] as const) {
      const res = await request.post(`/api/skills?namespace=${namespace}`, { headers, data: { files: skillFiles(name), visibility } });
      expect(res.status(), await res.text()).toBe(201);
    }

    const createAgent = await request.post('/api/agents', {
      headers: member,
      data: {
        name: `L3 Skill Holder ${stamp}`,
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        namespace: TEST_ORG_HANDLE,
      },
    });
    expect(createAgent.status(), await createAgent.text()).toBe(201);
    const agentId = ((await createAgent.json()) as { agent: { id: string } }).agent.id;
    const putAgent = (data: Record<string, unknown>) => request.put(`/api/agents/${agentId}`, { headers: member, data });
    const readAgent = async () =>
      ((await (await request.get(`/api/agents/${agentId}`, { headers: member })).json()) as {
        agent: { visibility: string; skills?: Array<{ namespace: string; id: string }> };
      }).agent;

    // The form's list: the workspace's own skills, then other workspaces' public ones.
    const available = await request.get(`/api/skills?namespace=${TEST_ORG_HANDLE}&includePublic=true`, { headers: member });
    const availableRefs = ((await available.json()) as { skills: Array<{ namespace: string; id: string }> }).skills
      .map((skill) => `${skill.namespace}/${skill.id}`);
    expect(availableRefs).toEqual(expect.arrayContaining([`${TEST_ORG_HANDLE}/${ownPrivate}`, `${OUTSIDER_NAMESPACE}/${otherPublic}`]));
    expect(availableRefs).not.toContain(`${OUTSIDER_NAMESPACE}/${otherPrivate}`);

    // Own private skill (bare id) and another workspace's public one, through the CLI.
    cli(baseURL, ['agent', 'set-skills', agentId, '--skills', `${ownPrivate},${OUTSIDER_NAMESPACE}/${otherPublic}`]);
    expect((await readAgent()).skills).toEqual([
      { namespace: TEST_ORG_HANDLE, id: ownPrivate },
      { namespace: OUTSIDER_NAMESPACE, id: otherPublic },
    ]);

    const unknown = await putAgent({ skills: [{ namespace: TEST_ORG_HANDLE, id: `e2e-missing-${stamp}` }] });
    expect(unknown.status()).toBe(400);
    expect(await unknown.text()).toContain(`e2e-missing-${stamp}`);

    const foreignPrivate = await putAgent({ skills: [{ namespace: OUTSIDER_NAMESPACE, id: otherPrivate }] });
    expect(foreignPrivate.status()).toBe(400);
    expect(await foreignPrivate.text()).toContain(otherPrivate);

    const madePublic = await putAgent({ visibility: 'public' });
    expect(madePublic.status()).toBe(400);
    expect(await madePublic.text()).toContain(`'${TEST_ORG_HANDLE}/${ownPrivate}' is private`);
    expect((await readAgent()).visibility).toBe('private');

    // Held skills: delete refused for both owners; the outsider sees the holder only as a count.
    const deleteOwn = await request.delete(`/api/skills/${ownPrivate}?namespace=${TEST_ORG_HANDLE}`, { headers: member });
    expect(deleteOwn.status()).toBe(409);
    expect(await deleteOwn.text()).toContain(`L3 Skill Holder ${stamp}`);
    const deleteOther = await request.delete(`/api/skills/${otherPublic}?namespace=${OUTSIDER_NAMESPACE}`, { headers: outsider });
    expect(deleteOther.status()).toBe(409);
    const deleteOtherBody = await deleteOther.text();
    expect(deleteOtherBody).toContain('1 agent you cannot see');
    expect(deleteOtherBody).not.toContain('L3 Skill Holder');
    const makePrivate = await request.patch(`/api/skills/${otherPublic}?namespace=${OUTSIDER_NAMESPACE}`, { headers: outsider, data: { visibility: 'private' } });
    expect(makePrivate.status()).toBe(409);

    // A public agent may hold the public skill; a later partial edit keeps it public.
    const goPublic = await putAgent({ visibility: 'public', skills: [{ namespace: OUTSIDER_NAMESPACE, id: otherPublic }] });
    expect(goPublic.status(), await goPublic.text()).toBe(200);
    expect((await putAgent({ description: 'edited' })).status()).toBe(200);
    expect((await readAgent()).visibility).toBe('public');

    cli(baseURL, ['agent', 'set-skills', agentId, '--skills', '']);
    expect((await readAgent()).skills).toEqual([]);
    const deleteFreed = await request.delete(`/api/skills/${otherPublic}?namespace=${OUTSIDER_NAMESPACE}`, { headers: outsider });
    expect(deleteFreed.ok(), await deleteFreed.text()).toBe(true);

    await request.delete(`/api/agents/${agentId}`, { headers: member });
    await request.delete(`/api/skills/${ownPrivate}?namespace=${TEST_ORG_HANDLE}`, { headers: member });
    await request.delete(`/api/skills/${otherPrivate}?namespace=${OUTSIDER_NAMESPACE}`, { headers: outsider });
  });
});
