import { test, expect } from '../helpers/test-fixtures';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import { probeGitHub } from '../helpers/github-reachable';

/**
 * Skill import from git — API E2E.
 *
 * `POST /api/skills/import` resolves a GitHub source, clones it anonymously and
 * writes each `<dir>/<name>/SKILL.md` folder as a Skill. The handler tests stub
 * the clone; this journey runs the route, the auth gate, a real clone and the
 * Postgres skill rows together. It pins a commit of this repository so the
 * folder it reads cannot move under it, and self-skips when GitHub is
 * unreachable or rate limited (as `workflow-import.journey` does).
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

const REPO = 'https://github.com/Appsilon/mediforce';
/** A `main` commit whose community-digest skills folder holds two skills. */
const COMMIT = 'a19d8bf1ceaae1f9c331ab129efb4f9998e158f0';
const DIR = 'apps/community-digest/plugins/community-digest/skills';

test.describe('Skill import from GitHub — API E2E', () => {
  let gitHubReachable = false;
  let namespace = '';

  test.beforeAll(async () => {
    ({ apiReachable: gitHubReachable } = await probeGitHub());
  });

  // `postgres-seed` drops `import-org-%` between runs.
  test.beforeEach(async ({}, testInfo) => {
    namespace = `import-org-skills-${testInfo.testId}`;
    await seedPostgresOrganizationNamespace(namespace, `uid-${namespace}`, 'Skill Import Org');
  });

  test('rejects an unauthenticated import', async ({ request }) => {
    const res = await request.post(`/api/skills/import?namespace=${namespace}`, { data: { repo: REPO, ref: COMMIT, dir: DIR } });
    expect(res.status()).toBe(401);
  });

  test('imports every skill folder under a directory, then leaves them alone on re-import', async ({ request }) => {
    test.skip(!gitHubReachable, 'GitHub unreachable or rate limited');
    // Two real clones of this repository.
    test.setTimeout(120_000);

    const first = await request.post(`/api/skills/import?namespace=${namespace}`, {
      headers: authHeaders,
      data: { repo: REPO, ref: COMMIT, dir: DIR },
    });
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toEqual({
      source: { url: REPO, commit: COMMIT, dir: DIR },
      skills: [
        { id: 'draft-discord-posts', outcome: 'created' },
        { id: 'rank-changes', outcome: 'created' },
      ],
    });

    const stored = await request.get(`/api/skills/rank-changes?namespace=${namespace}`, { headers: authHeaders });
    expect(stored.status(), await stored.text()).toBe(200);
    const { skill } = await stored.json() as { skill: { visibility: string; files: { path: string; contents: string }[] } };
    expect(skill.visibility).toBe('private');
    expect(skill.files.map((file) => file.path)).toContain('SKILL.md');

    const again = await request.post(`/api/skills/import?namespace=${namespace}`, {
      headers: authHeaders,
      data: { repo: REPO, ref: COMMIT, dir: DIR },
    });
    expect(again.status(), await again.text()).toBe(200);
    expect((await again.json() as { skills: unknown[] }).skills).toEqual([
      { id: 'draft-discord-posts', outcome: 'unchanged' },
      { id: 'rank-changes', outcome: 'unchanged' },
    ]);
  });

  test('refuses a directory holding no skill folders', async ({ request }) => {
    test.skip(!gitHubReachable, 'GitHub unreachable or rate limited');
    test.setTimeout(60_000);

    const res = await request.post(`/api/skills/import?namespace=${namespace}`, {
      headers: authHeaders,
      data: { repo: REPO, ref: COMMIT, dir: 'docs/adr' },
    });
    expect(res.status(), await res.text()).toBe(400);
    expect((await res.json() as { error: { message: string } }).error.message).toContain('No skill folders');
  });
});
