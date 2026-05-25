/**
 * Test helper: build a `CallerScope` from in-memory repos so handler tests
 * exercise the real wrapper logic (workspace gating, parent lookups) without
 * spinning up Firestore. Used by L2 handler tests in `platform-api/`.
 */
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
} from '@mediforce/platform-core/testing';
import type {
  AgentRun,
  AgentRunRepository,
  ModelRegistryRepository,
  NamespaceRepository,
  NamespaceSecretsRepository,
  ProcessInstanceRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import type { CallerScope } from '../caller-scope.js';
import { createCallerScope, type CallerScopeServices } from '../create-caller-scope.js';

class InMemoryAgentRunRepository implements AgentRunRepository {
  private readonly byId = new Map<string, AgentRun>();

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async create(run: AgentRun): Promise<AgentRun> {
    this.byId.set(run.id, run);
    return run;
  }
  async getById(runId: string): Promise<AgentRun | null> {
    return this.byId.get(runId) ?? null;
  }
  async getByIdInNamespaces(
    runId: string,
    allowed: readonly string[],
  ): Promise<AgentRun | null> {
    const run = this.byId.get(runId);
    if (!run) return null;
    const parent = await this.requireParents().getById(run.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? run : null;
  }
  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    return [...this.byId.values()].filter((r) => r.processInstanceId === instanceId);
  }
  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<AgentRun[]> {
    const parent = await this.requireParents().getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }
  async getAll(limit?: number): Promise<AgentRun[]> {
    const all = [...this.byId.values()];
    return limit === undefined ? all : all.slice(0, limit);
  }

  private requireParents(): ProcessInstanceRepository {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryAgentRunRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    return this.parents;
  }
}

const stubNamespaceRepo: NamespaceRepository = {
  async getNamespace() {
    return null;
  },
  async createNamespace() {
    /* no-op */
  },
  async updateNamespace() {
    /* no-op */
  },
  async getNamespacesByUser() {
    return [];
  },
  async addMember() {
    /* no-op */
  },
  async removeMember() {
    /* no-op */
  },
  async getMember() {
    return null;
  },
  async getMembers() {
    return [];
  },
  async getUserNamespaces() {
    return [];
  },
};

const stubPluginRegistry = { list: () => [] as ReadonlyArray<{ name: string; metadata?: unknown }> };

const stubModelRegistry: ModelRegistryRepository = {
  async getById() {
    return null;
  },
  async list() {
    return [];
  },
  async upsert(entry) {
    return entry as never;
  },
  async update(input) {
    return input as never;
  },
  async delete() {
    /* no-op */
  },
  async bulkUpsert() {
    return 0;
  },
  async updateRankings() {
    return 0;
  },
  async getMeta() {
    return {} as never;
  },
};

const stubWorkflowSecrets: WorkflowSecretsRepository = {
  async getSecrets() {
    return {};
  },
  async getSecretKeys() {
    return [];
  },
  async setSecrets() {
    /* no-op */
  },
  async deleteSecrets() {
    /* no-op */
  },
  async upsertSecret() {
    /* no-op */
  },
};
const stubNamespaceSecrets: NamespaceSecretsRepository = {
  async getSecrets() {
    return {};
  },
  async getSecretKeys() {
    return [];
  },
  async setSecrets() {
    /* no-op */
  },
  async upsertSecret() {
    /* no-op */
  },
  async deleteSecret() {
    /* no-op */
  },
};

export interface TestScopeOverrides {
  readonly caller?: CallerIdentity;
  readonly instanceRepo?: ProcessInstanceRepository;
  readonly humanTaskRepo?: InMemoryHumanTaskRepository;
  readonly processRepo?: InMemoryProcessRepository;
  readonly auditRepo?: InMemoryAuditRepository;
  readonly agentRunRepo?: AgentRunRepository;
  readonly handoffRepo?: InMemoryHandoffRepository;
  readonly agentDefinitionRepo?: InMemoryAgentDefinitionRepository;
  readonly coworkSessionRepo?: InMemoryCoworkSessionRepository;
  readonly cronTriggerStateRepo?: InMemoryCronTriggerStateRepository;
  readonly toolCatalogRepo?: InMemoryToolCatalogRepository;
  readonly oauthProviderRepo?: InMemoryOAuthProviderRepository;
  readonly agentOAuthTokenRepo?: InMemoryAgentOAuthTokenRepository;
  readonly pluginRegistry?: { list: () => ReadonlyArray<{ name: string; metadata?: unknown }> };
  readonly modelRegistryRepo?: ModelRegistryRepository;
}

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

/**
 * Build a `CallerScope` backed entirely by in-memory repositories. Default
 * caller is `apiKey` (system actor — bypasses workspace gating); pass a user
 * caller to exercise the workspace filter.
 *
 * Fields not exercised by a given test get safe defaults: empty stub repos
 * for everything not provided, and `null as never` for engine/triggers
 * (handlers that touch `scope.system` need explicit injection by overriding
 * after the scope is built).
 *
 * Construction order matters — indirect-namespace repos (humanTask, handoff,
 * audit, agentRun, coworkSession) take the shared `instanceRepo` as a
 * constructor dep so they can resolve parent-run namespaces internally.
 */
export function createTestScope(overrides: TestScopeOverrides = {}): CallerScope {
  const caller = overrides.caller ?? apiKeyCaller;
  const instanceRepo = overrides.instanceRepo ?? new InMemoryProcessInstanceRepository();
  const services: CallerScopeServices = {
    instanceRepo,
    processRepo: overrides.processRepo ?? new InMemoryProcessRepository(),
    auditRepo: overrides.auditRepo ?? new InMemoryAuditRepository(instanceRepo),
    agentRunRepo: overrides.agentRunRepo ?? new InMemoryAgentRunRepository(instanceRepo),
    humanTaskRepo: overrides.humanTaskRepo ?? new InMemoryHumanTaskRepository(instanceRepo),
    handoffRepo: overrides.handoffRepo ?? new InMemoryHandoffRepository(instanceRepo),
    agentDefinitionRepo: overrides.agentDefinitionRepo ?? new InMemoryAgentDefinitionRepository(),
    coworkSessionRepo: overrides.coworkSessionRepo ?? new InMemoryCoworkSessionRepository(instanceRepo),
    cronTriggerStateRepo: overrides.cronTriggerStateRepo ?? new InMemoryCronTriggerStateRepository(),
    toolCatalogRepo: overrides.toolCatalogRepo ?? new InMemoryToolCatalogRepository(),
    namespaceRepo: stubNamespaceRepo,
    oauthProviderRepo: overrides.oauthProviderRepo ?? new InMemoryOAuthProviderRepository(),
    agentOAuthTokenRepo: overrides.agentOAuthTokenRepo ?? new InMemoryAgentOAuthTokenRepository(),
    modelRegistryRepo: overrides.modelRegistryRepo ?? stubModelRegistry,
    secretsRepo: stubWorkflowSecrets,
    namespaceSecretsRepo: stubNamespaceSecrets,
    pluginRegistry: (overrides.pluginRegistry ?? stubPluginRegistry) as CallerScopeServices['pluginRegistry'],
    engine: null as unknown as CallerScopeServices['engine'],
    manualTrigger: null as unknown as CallerScopeServices['manualTrigger'],
    cronTrigger: null as unknown as CallerScopeServices['cronTrigger'],
    webhookRouter: null as unknown as CallerScopeServices['webhookRouter'],
    agentRunner: null as unknown as CallerScopeServices['agentRunner'],
  };
  return createCallerScope(services, caller);
}

/** Construct a user caller with the given namespace memberships. */
export function userCaller(uid: string, namespaces: readonly string[]): CallerIdentity {
  return { kind: 'user', uid, namespaces: new Set(namespaces), isSystemActor: false };
}
