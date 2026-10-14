import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemorySkillRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { importWorkflow, packageSkillsDir } from '../import-workflow';
import { createStubRepoFileReader } from '../../../runtime/repo-file-reader';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ValidationError } from '../../../errors';

// registerWorkflow (which import delegates to) rejects agent steps with no image
// unless local-agent mode is on, and otherwise probes the container runtime for
// image warnings — stub the docker seam so these tests stay offline.
vi.mock('../../system/_docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system/_docker')>();
  return {
    ...actual,
    isLocalAgentMode: vi.fn().mockReturnValue(false),
    fetchFromContainerWorker: vi.fn().mockResolvedValue({ available: false }),
    fetchFromLocalDocker: vi.fn().mockResolvedValue({ available: false }),
  };
});

// A valid .wd.json template — no namespace, version, or createdAt. The agent
// step needs an image so registerWorkflow's image check passes.
const _template = buildWorkflowDefinition({
  name: 'imported-workflow',
  namespace: 'unused',
  version: 1,
});
_template.steps[1].agent = { ..._template.steps[1].agent, image: 'test-image' };
const { namespace: _ns, version: _v, createdAt: _ca, ...VALID_TEMPLATE } = _template;

function buildScope() {
  const processRepo = new InMemoryProcessRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const auditRepo = new InMemoryAuditRepository(instanceRepo);
  return {
    scope: createTestScope({ processRepo, auditRepo, caller: userCaller('user-1', ['test-ns']) }),
    processRepo,
  };
}

describe('importWorkflow handler', () => {
  beforeEach(() => {
    resetFactorySequence();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A 40-char hex SHA — full SHAs skip the resolution round-trip, so a single
  // fetch mock (the raw file) is all most tests need.
  const SHA = 'a'.repeat(40);

  function mockFetchOk(body: unknown) {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  }

  function mockFetchFail(status = 404, statusText = 'Not Found') {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status,
      statusText,
    } as Response);
  }

  it('stores a WorkflowDefinition with source.url, source.path, source.commit set', async () => {
    mockFetchOk(VALID_TEMPLATE);
    const { scope, processRepo } = buildScope();

    const result = await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf/wf.wd.json', ref: SHA, namespace: 'test-ns' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'imported-workflow', version: 1 });
    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source).toEqual({
      url: 'https://github.com/Appsilon/mediforce-workflows',
      path: 'wf/wf.wd.json',
      commit: SHA,
    });
  });

  it('resolves a branch ref to a commit SHA, fetches at that SHA, and stores it', async () => {
    // First fetch: GitHub API resolves "main" -> SHA (plain text). Second: raw file.
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(`${SHA}\n`) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID_TEMPLATE) } as Response);
    const { scope, processRepo } = buildScope();

    await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf/wf.wd.json', namespace: 'test-ns' },
      scope,
    );

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce-workflows/commits/main',
    );
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain(`/${SHA}/`);
    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source?.commit).toBe(SHA);
  });

  it('imports from a tree URL with a slash-containing branch ref', async () => {
    vi.mocked(fetch)
      // GitHub rejects slash-containing candidates with 422, not 404.
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(`${SHA}\n`) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID_TEMPLATE) } as Response);
    const { scope, processRepo } = buildScope();

    await importWorkflow(
      {
        repo: 'https://github.com/Appsilon/mediforce/tree/feat/workflow-import-examples-default/docs/workflow-examples',
        path: '01-linear-pipeline.wd.json',
        namespace: 'test-ns',
      },
      scope,
    );

    expect(vi.mocked(fetch).mock.calls[3][0]).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce/${SHA}/docs/workflow-examples/01-linear-pipeline.wd.json`,
    );
    // Provenance drops the tree URL's mutable ref and its directory-relative
    // path: recording those would leave url + path + commit pointing nowhere once
    // the branch moves.
    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source).toEqual({
      url: 'https://github.com/Appsilon/mediforce',
      path: 'docs/workflow-examples/01-linear-pipeline.wd.json',
      commit: SHA,
    });
  });

  it('imports cleanly when the .wd.json declares a namespace (target wins)', async () => {
    mockFetchOk({ ...VALID_TEMPLATE, namespace: 'should-be-ignored' });
    const { scope, processRepo } = buildScope();

    await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf.wd.json', ref: SHA, namespace: 'test-ns' },
      scope,
    );

    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.namespace).toBe('test-ns');
  });

  it('throws ValidationError when fetch returns non-OK status', async () => {
    mockFetchFail(404, 'Not Found');
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'missing.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when .wd.json has invalid shape', async () => {
    mockFetchOk({ name: 'bad', steps: [] }); // missing required definition fields
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'bad.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for non-GitHub repo URL before any network call', async () => {
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://gitlab.com/org/repo', path: 'wf.wd.json', ref: 'main', namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('the Skills a package ships', () => {
    const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} instructions\n---\n# ${name}\n`;
    const withStepSkills = (refs: { namespace: string; id: string }[]) => ({
      ...VALID_TEMPLATE,
      steps: VALID_TEMPLATE.steps.map((step, index) =>
        index === 1 ? { ...step, agent: { ...step.agent, skills: refs } } : step),
    });

    function buildSkillScope(tree: Record<string, string>) {
      const processRepo = new InMemoryProcessRepository();
      const skillRepo = new InMemorySkillRepository();
      const repoFileReader = createStubRepoFileReader();
      repoFileReader.tree = Object.keys(tree).map((path) => ({ path }));
      repoFileReader.files = tree;
      const scope = createTestScope({ processRepo, skillRepo, repoFileReader, caller: userCaller('user-1', ['test-ns']) });
      return { scope, processRepo, skillRepo, repoFileReader };
    }

    it('creates them in the importing workspace and points the steps naming them there', async () => {
      mockFetchOk(withStepSkills([{ namespace: 'appsilon', id: 'summarize-record' }, { namespace: 'shared', id: 'not-shipped' }]));
      const { scope, processRepo, skillRepo } = buildSkillScope({
        'pkg/skills/summarize-record/SKILL.md': skillMd('summarize-record'),
        'pkg/src/pkg.wd.json': '{}',
      });
      await skillRepo.create({
        namespace: 'shared', id: 'not-shipped', name: 'not-shipped', description: 'public', visibility: 'public',
        contentHash: 'h', files: [{ path: 'SKILL.md', contents: skillMd('not-shipped') }],
      });

      const result = await importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'pkg/src/pkg.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      );

      expect(result.skills).toEqual([{ id: 'summarize-record', outcome: 'created' }]);
      expect(await skillRepo.getById('test-ns', 'summarize-record', { publicOnly: false })).not.toBeNull();
      const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
      expect(stored?.steps[1]?.agent?.skills).toEqual([
        { namespace: 'test-ns', id: 'summarize-record' },
        { namespace: 'shared', id: 'not-shipped' },
      ]);
    });

    it('leaves a reference to another namespace alone, even when the package ships a skill of that id', async () => {
      mockFetchOk({ ...withStepSkills([{ namespace: 'shared', id: 'summarize-record' }]), namespace: 'appsilon' });
      const { scope, processRepo, skillRepo } = buildSkillScope({ 'pkg/skills/summarize-record/SKILL.md': skillMd('summarize-record') });
      await skillRepo.create({
        namespace: 'shared', id: 'summarize-record', name: 'summarize-record', description: 'public', visibility: 'public',
        contentHash: 'h', files: [{ path: 'SKILL.md', contents: skillMd('summarize-record') }],
      });

      await importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'pkg/src/pkg.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      );

      const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
      expect(stored?.steps[1]?.agent?.skills).toEqual([{ namespace: 'shared', id: 'summarize-record' }]);
    });

    it('writes no skill when the definition cannot register', async () => {
      mockFetchOk({ ...withStepSkills([{ namespace: 'appsilon', id: 'summarize-record' }]), transitions: [{ from: 'nowhere', to: 'done' }] });
      const { scope, skillRepo } = buildSkillScope({ 'pkg/skills/summarize-record/SKILL.md': skillMd('summarize-record') });

      await expect(importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'pkg/src/pkg.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      )).rejects.toThrow(ValidationError);
      expect(await skillRepo.getById('test-ns', 'summarize-record', { publicOnly: false })).toBeNull();
    });

    it('writes no skill when a step also names a skill that does not exist', async () => {
      mockFetchOk(withStepSkills([{ namespace: 'appsilon', id: 'summarize-record' }, { namespace: 'shared', id: 'missing' }]));
      const { scope, skillRepo } = buildSkillScope({ 'pkg/skills/summarize-record/SKILL.md': skillMd('summarize-record') });

      await expect(importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'pkg/src/pkg.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      )).rejects.toThrow(ValidationError);
      expect(await skillRepo.getById('test-ns', 'summarize-record', { publicOnly: false })).toBeNull();
    });

    it('registers nothing and creates nothing when a shipped skill folder is invalid', async () => {
      mockFetchOk(withStepSkills([{ namespace: 'appsilon', id: 'summarize-record' }]));
      const { scope, processRepo, skillRepo } = buildSkillScope({ 'pkg/skills/summarize-record/SKILL.md': '# no frontmatter\n' });

      await expect(importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'pkg/src/pkg.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      )).rejects.toThrow(ValidationError);
      expect(await skillRepo.getById('test-ns', 'summarize-record', { publicOnly: false })).toBeNull();
      expect(await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1)).toBeNull();
    });
  });

  it('finds a package\'s skills next to its src/ folder, or next to the file otherwise', () => {
    expect(packageSkillsDir('apps/tealflow/src/tealflow.wd.json')).toBe('apps/tealflow/skills');
    expect(packageSkillsDir('examples/review.wd.json')).toBe('examples/skills');
    expect(packageSkillsDir('src/root.wd.json')).toBe('skills');
    expect(packageSkillsDir('root.wd.json')).toBe('skills');
  });
});
