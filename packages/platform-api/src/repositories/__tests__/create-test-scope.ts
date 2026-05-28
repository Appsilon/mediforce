/**
 * Test helper: build a `CallerScope` from in-memory repos so handler tests
 * exercise the real wrapper logic (workspace gating, parent lookups) without
 * spinning up Firestore. Used by L2 handler tests in `platform-api/`.
 */
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAgentRunRepository,
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
  AgentRunRepository,
  ModelRegistryRepository,
  NamespaceRepository,
  NamespaceSecretsRepository,
  ProcessInstanceRepository,
  UserDirectoryService,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import type { CallerScope } from '../caller-scope.js';
import { createCallerScope, type CallerScopeServices } from '../create-caller-scope.js';
import { noopRunKicker, type RunKicker } from '../../runtime/run-kicker.js';
import type { DockerImagesService } from '../../services/docker-images-service.js';
import type { InviteNotificationService, InviteService } from '../../services/invite-notification.js';

const stubNamespaceRepo: NamespaceRepository = {
  async getNamespace() {
    return null;
  },
  async createNamespace() {
    /* no-op */
  },
  async createNamespaceWithOwner() {
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
  async getMembershipsForUser() {
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
  async deleteSecret() {
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
  readonly secretsRepo?: WorkflowSecretsRepository;
  readonly namespaceSecretsRepo?: NamespaceSecretsRepository;
  readonly runKicker?: RunKicker;
  readonly inviteService?: InviteService | null;
  readonly inviteNotificationService?: InviteNotificationService | null;
  readonly dockerImages?: DockerImagesService | null;
  readonly namespaceRepo?: NamespaceRepository;
  readonly userDirectory?: UserDirectoryService | null;
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
    namespaceRepo: overrides.namespaceRepo ?? stubNamespaceRepo,
    oauthProviderRepo: overrides.oauthProviderRepo ?? new InMemoryOAuthProviderRepository(),
    agentOAuthTokenRepo: overrides.agentOAuthTokenRepo ?? new InMemoryAgentOAuthTokenRepository(),
    modelRegistryRepo: overrides.modelRegistryRepo ?? stubModelRegistry,
    secretsRepo: overrides.secretsRepo ?? stubWorkflowSecrets,
    namespaceSecretsRepo: overrides.namespaceSecretsRepo ?? stubNamespaceSecrets,
    pluginRegistry: (overrides.pluginRegistry ?? stubPluginRegistry) as CallerScopeServices['pluginRegistry'],
    engine: null as unknown as CallerScopeServices['engine'],
    manualTrigger: null as unknown as CallerScopeServices['manualTrigger'],
    cronTrigger: null as unknown as CallerScopeServices['cronTrigger'],
    webhookRouter: null as unknown as CallerScopeServices['webhookRouter'],
    agentRunner: null as unknown as CallerScopeServices['agentRunner'],
    runKicker: overrides.runKicker ?? noopRunKicker(),
    inviteService: overrides.inviteService ?? null,
    inviteNotificationService: overrides.inviteNotificationService ?? null,
    dockerImages: overrides.dockerImages ?? null,
    userDirectory: overrides.userDirectory ?? null,
  };
  return createCallerScope(services, caller);
}

/**
 * Construct a user caller with the given namespace memberships.
 *
 * Roles default to `'member'` per namespace — callers that need owner/admin
 * pass an explicit `roles` map. This default keeps every pre-Phase-2.6 test
 * site (which never knew about roles) working without modification while
 * still producing a fully-shaped `CallerIdentity.namespaceRoles`.
 */
export function userCaller(
  uid: string,
  namespaces: readonly string[],
  roles?: ReadonlyMap<string, 'owner' | 'admin' | 'member'>,
): CallerIdentity {
  const namespaceRoles = new Map<string, 'owner' | 'admin' | 'member'>();
  for (const handle of namespaces) {
    namespaceRoles.set(handle, roles?.get(handle) ?? 'member');
  }
  return {
    kind: 'user',
    uid,
    namespaces: new Set(namespaces),
    namespaceRoles,
    isSystemActor: false,
  };
}
