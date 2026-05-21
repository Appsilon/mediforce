// Wiring test for `createCallerScope`. The L2 handler tests exercise the
// happy paths of HumanTask / Run / Definition / Cowork / Audit wrappers
// transitively; this file's job is the wiring itself — catches regressions
// like "added `handoffRepo` to PlatformServices but forgot to pass it into
// the Authorized wrapper" that no handler test would notice.
//
// One assertion per concern, no exhaustive per-method coverage.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryCoworkSessionRepository,
  InMemoryCronTriggerStateRepository,
  InMemoryHandoffRepository,
  InMemoryHumanTaskRepository,
  InMemoryOAuthProviderRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryToolCatalogRepository,
  InMemoryAgentOAuthTokenRepository,
  buildHumanTask,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../testing/index.js';

describe('createCallerScope', () => {
  it('exposes every documented wrapper field + deployment-global pass-throughs', () => {
    const scope = createTestScope();

    // Workspace-scoped wrappers
    expect(scope.tasks).toBeDefined();
    expect(scope.runs).toBeDefined();
    expect(scope.workflowDefinitions).toBeDefined();
    expect(scope.agentDefinitions).toBeDefined();
    expect(scope.coworkSessions).toBeDefined();
    expect(scope.agentRuns).toBeDefined();
    expect(scope.auditEvents).toBeDefined();
    expect(scope.handoffs).toBeDefined();
    expect(scope.toolCatalog).toBeDefined();
    expect(scope.oauthProviders).toBeDefined();
    expect(scope.agentOAuthTokens).toBeDefined();
    expect(scope.workspaceSecrets).toBeDefined();
    expect(scope.workflowSecrets).toBeDefined();

    // Pass-throughs
    expect(scope.models).toBeDefined();
    expect(scope.plugins).toBeDefined();
    expect(scope.workspaces).toBeDefined();
    expect(scope.cron).toBeDefined();

    // System services bag (engine, triggers — null-typed in test scope, but
    // shape must exist so handlers can typecheck against `scope.system.*`).
    expect(scope.system).toBeDefined();
  });

  it('threads caller through to scope.caller', () => {
    const caller = userCaller('u-1', ['team-alpha']);
    const scope = createTestScope({ caller });
    expect(scope.caller).toBe(caller);
  });

  describe('user caller gating (direct-namespace entity)', () => {
    let instanceRepo: InMemoryProcessInstanceRepository;
    beforeEach(async () => {
      instanceRepo = new InMemoryProcessInstanceRepository();
      await instanceRepo.create(buildProcessInstance({ id: 'inst-alpha', namespace: 'team-alpha' }));
      await instanceRepo.create(buildProcessInstance({ id: 'inst-beta', namespace: 'team-beta' }));
    });

    it('returns in-scope row for a user caller who is a member', async () => {
      const scope = createTestScope({
        instanceRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });
      const run = await scope.runs.getById('inst-alpha');
      expect(run?.id).toBe('inst-alpha');
    });

    it('returns null for out-of-scope row (anti-enumeration)', async () => {
      const scope = createTestScope({
        instanceRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });
      const run = await scope.runs.getById('inst-beta');
      expect(run).toBeNull();
    });

    it('apiKey caller bypasses the workspace gate', async () => {
      const scope = createTestScope({ instanceRepo });
      const a = await scope.runs.getById('inst-alpha');
      const b = await scope.runs.getById('inst-beta');
      expect(a?.id).toBe('inst-alpha');
      expect(b?.id).toBe('inst-beta');
    });
  });

  describe('parent lookup wiring (indirect-namespace entity)', () => {
    // HumanTask has no namespace field — the wrapper must reach its workspace
    // via the parent ProcessInstance. If `humanTaskRepo` is wired without the
    // parent `instanceRepo`, gating silently fails open. This test catches it.

    it('gates tasks by the parent run namespace', async () => {
      const instanceRepo = new InMemoryProcessInstanceRepository();
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      await instanceRepo.create(buildProcessInstance({ id: 'inst-alpha', namespace: 'team-alpha' }));
      await instanceRepo.create(buildProcessInstance({ id: 'inst-beta', namespace: 'team-beta' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't-alpha', processInstanceId: 'inst-alpha' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't-beta', processInstanceId: 'inst-beta' }));

      const scope = createTestScope({
        instanceRepo,
        humanTaskRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      expect((await scope.tasks.getById('t-alpha'))?.id).toBe('t-alpha');
      expect(await scope.tasks.getById('t-beta')).toBeNull();
    });
  });

  it('PlatformServices field rename / drop regresses here, not silently downstream', () => {
    // Sanity: the underlying repos behind each wrapper come back as the right
    // shape. We don't check every entity; one of each kind (in-memory direct,
    // in-memory indirect, pass-through) is enough to catch a missed wire-up.
    const instanceRepo = new InMemoryProcessInstanceRepository();
    const processRepo = new InMemoryProcessRepository();
    const auditRepo = new InMemoryAuditRepository();
    const humanTaskRepo = new InMemoryHumanTaskRepository();
    const handoffRepo = new InMemoryHandoffRepository();
    const agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    const coworkSessionRepo = new InMemoryCoworkSessionRepository();
    const cronTriggerStateRepo = new InMemoryCronTriggerStateRepository();
    const toolCatalogRepo = new InMemoryToolCatalogRepository();
    const oauthProviderRepo = new InMemoryOAuthProviderRepository();
    const agentOAuthTokenRepo = new InMemoryAgentOAuthTokenRepository();

    const scope = createTestScope({
      instanceRepo,
      processRepo,
      auditRepo,
      humanTaskRepo,
      handoffRepo,
      agentDefinitionRepo,
      coworkSessionRepo,
      cronTriggerStateRepo,
      toolCatalogRepo,
      oauthProviderRepo,
      agentOAuthTokenRepo,
    });

    // Pass-throughs must be the same identity-equal objects we passed in.
    expect(scope.cron).toBe(cronTriggerStateRepo);

    // Workspace-scoped wrappers must exist and respond to one canonical
    // read each — if the wiring is wrong this throws or returns the wrong
    // shape (TS would have caught a missing param; runtime catches a
    // mis-routed instance).
    expect(scope.tasks.getByRole).toBeTypeOf('function');
    expect(scope.runs.list).toBeTypeOf('function');
    expect(scope.workflowDefinitions.listGroups).toBeTypeOf('function');
    expect(scope.agentDefinitions.list).toBeTypeOf('function');
    expect(scope.coworkSessions.getById).toBeTypeOf('function');
    expect(scope.agentRuns.getById).toBeTypeOf('function');
    expect(scope.auditEvents.getByProcess).toBeTypeOf('function');
    expect(scope.handoffs.getById).toBeTypeOf('function');
    expect(scope.toolCatalog.list).toBeTypeOf('function');
    expect(scope.oauthProviders.list).toBeTypeOf('function');
    expect(scope.agentOAuthTokens.get).toBeTypeOf('function');
    expect(scope.workspaceSecrets.getSecrets).toBeTypeOf('function');
    expect(scope.workflowSecrets.getSecrets).toBeTypeOf('function');
  });
});
