import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryAgentDefinitionRepository, InMemoryAuditRepository, InMemoryProcessInstanceRepository, InMemoryProcessRepository, InMemorySkillRepository, InMemoryToolCatalogRepository, buildWorkflowDefinition, resetFactorySequence } from '@mediforce/platform-core/testing';
import { createAgent } from '../../agents/create-agent';
import { updateAgent } from '../../agents/update-agent';
import { askAgentAssistant } from '../ask-agent-assistant';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import type { CallerScope } from '../../../repositories/index';

const skillMd = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

type Request = { messages: Array<{ role: string; content: string }> };
type Turn = (request: Request) => { content?: string; toolCalls?: Array<{ name: string; arguments: unknown }> };

function scriptOpenRouter(turns: Turn[]): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as Request;
    requests.push(request);
    const next: Turn = turns.shift() ?? (() => ({ content: 'done' }));
    const turn = next(request);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: turn.content ?? '',
          tool_calls: (turn.toolCalls ?? []).map((call, index) => ({
            id: `call-${requests.length}-${index}`, type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        },
        finish_reason: 'stop',
      }],
    }));
  }));
  return requests;
}

function lastToolResult(request: Request): unknown {
  const tool = [...request.messages].reverse().find((message) => message.role === 'tool');
  return JSON.parse((tool as unknown as { content: string }).content);
}

describe('askAgentAssistant', () => {
  function buildScope(): { scope: CallerScope; agentDefinitionRepo: InMemoryAgentDefinitionRepository; processRepo: InMemoryProcessRepository } {
    resetFactorySequence();
    const agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    const auditRepo = new InMemoryAuditRepository(instanceRepo);
    const skillRepo = new InMemorySkillRepository();
    const toolCatalogRepo = new InMemoryToolCatalogRepository();
    const processRepo = new InMemoryProcessRepository();
    const scope = createTestScope({ agentDefinitionRepo, auditRepo, skillRepo, toolCatalogRepo, processRepo, caller: userCaller('u-1', ['team-alpha']) });
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
    return { scope, agentDefinitionRepo, processRepo };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers from the namespace\'s own Agent catalog, not a guess', async () => {
    const { scope } = buildScope();
    await createAgent({
      kind: 'plugin', name: 'AE Grader', iconName: 'Shield', description: 'Grades adverse events against CTCAE v5.0.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);

    const requests = scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'list_agents', arguments: {} }] }),
      () => ({ content: 'AE Grader already grades adverse events with CTCAE v5.0.' }),
    ]);

    const progressEvents: Array<{ type: string; tool?: string; status?: string; arguments?: unknown }> = [];
    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'I need an agent that grades adverse events with CTCAE.' }] },
      scope,
      (event) => progressEvents.push(event),
    );

    const agents = lastToolResult(requests[1]!) as Array<{ name: string }>;
    expect(agents.map((agent) => agent.name)).toEqual(['AE Grader']);
    expect(result).toEqual({ reply: 'AE Grader already grades adverse events with CTCAE v5.0.', proposals: [] });
    // The call's own arguments ride along on the 'running' event — the UI uses this to
    // tell which agent card a step is reading, without waiting for the tool to finish.
    expect(progressEvents).toContainEqual(expect.objectContaining({ type: 'tool', tool: 'list_agents', status: 'running', arguments: {} }));
  });

  it('proposes the matching agent instead of creating one', async () => {
    const { scope } = buildScope();
    const { agent } = await createAgent({
      kind: 'plugin', name: 'AE Grader', iconName: 'Shield', description: 'Grades adverse events against CTCAE v5.0.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'list_agents', arguments: {} }] }),
      () => ({ toolCalls: [{ name: 'propose_agent_match', arguments: { agentId: agent.id, rationale: 'It already grades with CTCAE v5.0.' } }] }),
      () => ({ content: 'AE Grader already does this.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'I need an agent that grades adverse events with CTCAE.' }] },
      scope,
    );

    expect(result).toEqual({
      reply: 'AE Grader already does this.',
      proposals: [{
        tool: 'propose_agent_match',
        arguments: { agentId: agent.id, rationale: 'It already grades with CTCAE v5.0.' },
        evidence: { qualification: null, usedIn: [] },
      }],
    });
  });

  it('refuses a match proposal naming an agent the caller cannot see', async () => {
    const { scope } = buildScope();
    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_agent_match', arguments: { agentId: 'made-up-id', rationale: 'r' } }] }),
      (request) => ({ content: JSON.stringify(lastToolResult(request)) }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Anything that fits?' }] },
      scope,
    );

    expect(result.proposals).toEqual([]);
    expect(result.reply).toContain('is visible to you');
  });

  it('reads one agent in full and checks the Skill and MCP catalogs before answering', async () => {
    const { scope, agentDefinitionRepo } = buildScope();
    const { agent } = await createAgent({
      kind: 'plugin', name: 'SDTM Mapper', iconName: 'Table', description: 'Maps SDTM to ADaM.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'Map carefully.', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);
    await scope.skills.create({
      namespace: 'team-alpha', id: 'define-xml-generator', name: 'define-xml-generator',
      description: 'Generate Define-XML 2.1 for ADaM datasets.', visibility: 'private', contentHash: 'h1',
      files: [{ path: 'SKILL.md', contents: skillMd('define-xml-generator', 'Generate Define-XML 2.1 for ADaM datasets.') }],
    });
    await scope.toolCatalog.upsert('team-alpha', { id: 'ctgov-results', type: 'stdio', command: 'uvx', description: 'ClinicalTrials.gov posted results.' });

    const requests = scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'read_agent', arguments: { id: agent.id } }] }),
      () => ({ toolCalls: [{ name: 'search_skill_catalog', arguments: { query: 'define-xml' } }] }),
      () => ({ toolCalls: [{ name: 'search_mcp_catalog', arguments: { query: 'clinicaltrials' } }] }),
      () => ({ content: 'SDTM Mapper has no define.xml skill; define-xml-generator already exists and ctgov-results covers posted results.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Does anything already write define.xml?' }] },
      scope,
    );

    expect(lastToolResult(requests[1]!)).toMatchObject({ systemPrompt: 'Map carefully.', visibility: 'private' });
    expect(lastToolResult(requests[2]!)).toEqual([
      { namespace: 'team-alpha', id: 'define-xml-generator', name: 'define-xml-generator', description: 'Generate Define-XML 2.1 for ADaM datasets.', visibility: 'private' },
    ]);
    expect(lastToolResult(requests[3]!)).toEqual([
      { id: 'ctgov-results', type: 'stdio', description: 'ClinicalTrials.gov posted results.' },
    ]);
    expect(result.reply).toContain('define-xml-generator already exists');
    expect(await agentDefinitionRepo.listAll()).toHaveLength(1);
  });

  it('proposes adding an existing Skill to a close-fit agent', async () => {
    const { scope } = buildScope();
    const { agent } = await createAgent({
      kind: 'plugin', name: 'SDTM Mapper', iconName: 'Table', description: 'Maps SDTM to ADaM.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);
    await scope.skills.create({
      namespace: 'team-alpha', id: 'define-xml-generator', name: 'define-xml-generator',
      description: 'Generate Define-XML 2.1.', visibility: 'private', contentHash: 'h1',
      files: [{ path: 'SKILL.md', contents: skillMd('define-xml-generator', 'Generate Define-XML 2.1.') }],
    });

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_agent_change', arguments: { agentId: agent.id, skill: { namespace: 'team-alpha', id: 'define-xml-generator' }, rationale: 'Adds Define-XML output.' } }] }),
      () => ({ content: 'Add define-xml-generator to SDTM Mapper.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Can SDTM Mapper also write define.xml?' }] },
      scope,
    );

    expect(result).toEqual({
      reply: 'Add define-xml-generator to SDTM Mapper.',
      proposals: [{
        tool: 'propose_agent_change',
        arguments: { agentId: agent.id, skill: { namespace: 'team-alpha', id: 'define-xml-generator' }, rationale: 'Adds Define-XML output.' },
        evidence: { qualification: null, usedIn: [] },
      }],
    });

    // Accepting the card is the same update a person's own form makes — proven here directly, no new accept path to build.
    const updated = await updateAgent({ id: agent.id, body: { skills: [{ namespace: 'team-alpha', id: 'define-xml-generator' }] } }, scope);
    expect(updated.agent.skills).toEqual([{ namespace: 'team-alpha', id: 'define-xml-generator' }]);
    expect(await scope.agentDefinitions.listVersions(agent.id)).toHaveLength(2);
  });

  it('refuses a change proposal naming a Skill the agent already holds', async () => {
    const { scope } = buildScope();
    await scope.skills.create({
      namespace: 'team-alpha', id: 'sdtm-mapping', name: 'sdtm-mapping',
      description: 'Map SDTM.', visibility: 'private', contentHash: 'h1',
      files: [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'Map SDTM.') }],
    });
    const { agent } = await createAgent({
      kind: 'plugin', name: 'SDTM Mapper', iconName: 'Table', description: 'Maps SDTM to ADaM.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private', skills: [{ namespace: 'team-alpha', id: 'sdtm-mapping' }],
    }, scope);

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_agent_change', arguments: { agentId: agent.id, skill: { namespace: 'team-alpha', id: 'sdtm-mapping' }, rationale: 'r' } }] }),
      (request) => ({ content: JSON.stringify(lastToolResult(request)) }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Can it also map SDTM?' }] },
      scope,
    );

    expect(result.proposals).toEqual([]);
    expect(result.reply).toContain('already holds');
  });

  it('proposes a new private agent, reusing a catalog Skill and drafting one new one', async () => {
    const { scope, agentDefinitionRepo } = buildScope();
    await scope.skills.create({
      namespace: 'team-alpha', id: 'trial-metadata-extractor', name: 'trial-metadata-extractor',
      description: 'Extract protocol metadata.', visibility: 'private', contentHash: 'h1',
      files: [{ path: 'SKILL.md', contents: skillMd('trial-metadata-extractor', 'Extract protocol metadata.') }],
    });
    const newSkill = {
      id: 'benchmark-eligibility',
      description: 'Compare eligibility criteria with completed trials.',
      body: '1. Group criteria.\n2. Search comparator trials.\n3. Flag the strict ones.',
    };

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'search_skill_catalog', arguments: { query: 'eligibility' } }] }),
      () => ({
        toolCalls: [{
          name: 'propose_new_agent',
          arguments: {
            name: 'Eligibility Benchmarker', iconName: 'Flask', description: 'Benchmarks eligibility criteria.',
            foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'Protocol PDF', outputDescription: 'JSON findings',
            skills: [{ namespace: 'team-alpha', id: 'trial-metadata-extractor' }],
            newSkill,
            rationale: 'Nothing in the catalog compares criteria against other trials.',
          },
        }],
      }),
      () => ({ content: 'Drafted Eligibility Benchmarker.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Benchmark our eligibility criteria against other trials.' }] },
      scope,
    );

    expect(result.proposals).toEqual([{
      tool: 'propose_new_agent',
      arguments: {
        name: 'Eligibility Benchmarker', iconName: 'Flask', description: 'Benchmarks eligibility criteria.',
        foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'Protocol PDF', outputDescription: 'JSON findings',
        skills: [{ namespace: 'team-alpha', id: 'trial-metadata-extractor' }],
        newSkill,
        rationale: 'Nothing in the catalog compares criteria against other trials.',
      },
    }]);

    // Accepting the card is the same create-agent + create-skill a person's own form makes — proven here directly.
    await scope.skills.create({
      namespace: 'team-alpha', id: newSkill.id, name: newSkill.id, description: newSkill.description,
      visibility: 'private', contentHash: 'h2',
      files: [{ path: 'SKILL.md', contents: skillMd(newSkill.id, newSkill.description) }],
    });
    const { agent } = await createAgent({
      kind: 'plugin', name: 'Eligibility Benchmarker', iconName: 'Flask', description: 'Benchmarks eligibility criteria.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'Protocol PDF', outputDescription: 'JSON findings',
      namespace: 'team-alpha', visibility: 'private',
      skills: [{ namespace: 'team-alpha', id: 'trial-metadata-extractor' }, { namespace: 'team-alpha', id: newSkill.id }],
    }, scope);

    expect(agent.visibility).toBe('private');
    expect(agent.skills).toEqual([
      { namespace: 'team-alpha', id: 'trial-metadata-extractor' },
      { namespace: 'team-alpha', id: 'benchmark-eligibility' },
    ]);
    expect(await agentDefinitionRepo.listAll()).toHaveLength(1);
  });

  it('refuses a new-agent proposal naming a Skill id already taken', async () => {
    const { scope } = buildScope();
    await scope.skills.create({
      namespace: 'team-alpha', id: 'benchmark-eligibility', name: 'benchmark-eligibility',
      description: 'Already here.', visibility: 'private', contentHash: 'h1',
      files: [{ path: 'SKILL.md', contents: skillMd('benchmark-eligibility', 'Already here.') }],
    });

    scriptOpenRouter([
      () => ({
        toolCalls: [{
          name: 'propose_new_agent',
          arguments: {
            name: 'Eligibility Benchmarker', iconName: 'Flask', description: 'd',
            foundationModel: 'm', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
            skills: [],
            newSkill: { id: 'benchmark-eligibility', description: 'd', body: 'b' },
            rationale: 'r',
          },
        }],
      }),
      (request) => ({ content: JSON.stringify(lastToolResult(request)) }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Build one.' }] },
      scope,
    );

    expect(result.proposals).toEqual([]);
    expect(result.reply).toContain('already exists');
  });

  it('proposes a requirement matrix scoring the real candidates it read', async () => {
    const { scope } = buildScope();
    const { agent: aeGrader } = await createAgent({
      kind: 'plugin', name: 'AE Grader', iconName: 'Shield', description: 'Grades adverse events against CTCAE v5.0.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);
    const { agent: validator } = await createAgent({
      kind: 'plugin', name: 'Data Validator', iconName: 'Grid', description: 'Checks dataset structure.',
      foundationModel: 'claude-haiku-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);

    const matrix = {
      requirements: ['Reads an AE listing', 'Grades with CTCAE v5.0'],
      candidates: [
        { agentId: aeGrader.id, name: 'AE Grader', cells: [{ verdict: 'y', evidence: 'Input is SDTM AE' }, { verdict: 'y', evidence: 'Skill ctcae-grading' }] },
        { agentId: validator.id, name: 'Data Validator', cells: [{ verdict: 'y', evidence: 'Validates AE domain structure' }, { verdict: 'n', evidence: 'No grading logic' }] },
      ],
    };

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_requirement_matrix', arguments: matrix }] }),
      () => ({ toolCalls: [{ name: 'propose_agent_match', arguments: { agentId: aeGrader.id, rationale: 'Only one that grades.' } }] }),
      () => ({ content: 'AE Grader covers both requirements; Data Validator only the first.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Grade AEs with CTCAE v5.0.' }] },
      scope,
    );

    expect(result.proposals).toEqual([
      { tool: 'propose_requirement_matrix', arguments: matrix },
      {
        tool: 'propose_agent_match',
        arguments: { agentId: aeGrader.id, rationale: 'Only one that grades.' },
        evidence: { qualification: null, usedIn: [] },
      },
    ]);
  });

  it('refuses a requirement matrix naming a candidate the caller cannot see', async () => {
    const { scope } = buildScope();
    scriptOpenRouter([
      () => ({
        toolCalls: [{
          name: 'propose_requirement_matrix',
          arguments: { requirements: ['Does the thing'], candidates: [{ agentId: 'made-up-id', name: 'Ghost', cells: [{ verdict: 'y', evidence: 'e' }] }] },
        }],
      }),
      (request) => ({ content: JSON.stringify(lastToolResult(request)) }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Compare agents.' }] },
      scope,
    );

    expect(result.proposals).toEqual([]);
    expect(result.reply).toContain('is visible to you');
  });

  it('attaches real evidence to a match proposal: which steps already use it, and its qualification', async () => {
    const { scope, processRepo } = buildScope();
    const { agent } = await createAgent({
      kind: 'plugin', name: 'AE Grader', iconName: 'Shield', description: 'Grades adverse events against CTCAE v5.0.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);
    await processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: 'safety-review', namespace: 'team-alpha', version: 1,
      steps: [{ id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: agent.id }],
      transitions: [],
    }));

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_agent_match', arguments: { agentId: agent.id, rationale: 'Already does this.' } }] }),
      () => ({ content: 'AE Grader already does this.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Grade adverse events with CTCAE.' }] },
      scope,
    );

    expect(result.proposals).toEqual([{
      tool: 'propose_agent_match',
      arguments: { agentId: agent.id, rationale: 'Already does this.' },
      // Not evaluated yet (no runtimeId set, so listAgentValidations skips it) — qualification is honestly null, not invented.
      evidence: { qualification: null, usedIn: ['safety-review (step grade-aes)'] },
    }]);
  });

  it('proposes wiring an existing MCP server, pending admin approval', async () => {
    const { scope } = buildScope();
    const { agent } = await createAgent({
      kind: 'plugin', name: 'AE Grader', iconName: 'Shield', description: 'Grades adverse events against CTCAE v5.0.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);
    await scope.toolCatalog.upsert('team-alpha', { id: 'ctgov-results', type: 'stdio', command: 'uvx', description: 'ClinicalTrials.gov posted results.' });

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_mcp_binding', arguments: { agentId: agent.id, serverId: 'ctgov-results', rationale: 'Needs posted trial results.' } }] }),
      () => ({ content: 'Wire ctgov-results onto AE Grader.' }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Can it pull posted trial results too?' }] },
      scope,
    );

    expect(result).toEqual({
      reply: 'Wire ctgov-results onto AE Grader.',
      proposals: [{
        tool: 'propose_mcp_binding',
        arguments: { agentId: agent.id, serverId: 'ctgov-results', rationale: 'Needs posted trial results.' },
        evidence: { qualification: null, usedIn: [] },
      }],
    });
  });

  it('refuses an MCP binding proposal naming a server not in the catalog', async () => {
    const { scope } = buildScope();
    const { agent } = await createAgent({
      kind: 'plugin', name: 'AE Grader', iconName: 'Shield', description: 'Grades adverse events against CTCAE v5.0.',
      foundationModel: 'claude-sonnet-5-5', systemPrompt: 'p', inputDescription: 'in', outputDescription: 'out',
      namespace: 'team-alpha', visibility: 'private',
    }, scope);

    scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'propose_mcp_binding', arguments: { agentId: agent.id, serverId: 'made-up-server', rationale: 'r' } }] }),
      (request) => ({ content: JSON.stringify(lastToolResult(request)) }),
    ]);

    const result = await askAgentAssistant(
      { namespace: 'team-alpha', messages: [{ role: 'user', content: 'Wire a server that does not exist.' }] },
      scope,
    );

    expect(result.proposals).toEqual([]);
    expect(result.reply).toContain('is visible to you');
  });
});
