// packages/platform-ui/src/lib/platform-services.ts
import {
  FirestoreProcessRepository,
  FirestoreProcessInstanceRepository,
  FirestoreAuditRepository,
  FirestoreAgentRunRepository,
  FirestoreHumanTaskRepository,
  FirestoreAgentDefinitionRepository,
  FirestoreCoworkSessionRepository,
  FirestoreCronTriggerStateRepository,
  initializeFirebase,
  getFirestoreDb,
  validateSecretsKey,
} from '@mediforce/platform-infra';
import { connectFirestoreEmulator } from 'firebase/firestore';
import type { CronTriggerStateRepository } from '@mediforce/platform-core';
import {
  WorkflowEngine,
  ManualTrigger,
  CronTrigger,
} from '@mediforce/workflow-engine';
import {
  AgentRunner,
  PluginRegistry,
  OpenRouterLlmClient,
  FirestoreAgentEventLog,
  ClaudeCodeAgentPlugin,
  MockClaudeCodeAgentPlugin,
  OpenCodeAgentPlugin,
  ScriptContainerPlugin,
} from '@mediforce/agent-runtime';
import { registerSupplyIntelligencePlugins } from '@mediforce/supply-intelligence-plugins';
import { seedBuiltinAgentDefinitions } from './seed-agent-definitions.js';

let services: PlatformServices | null = null;
let seedingStarted = false;

export interface PlatformServices {
  engine: WorkflowEngine;
  manualTrigger: ManualTrigger;
  cronTrigger: CronTrigger;
  agentRunner: AgentRunner;
  pluginRegistry: PluginRegistry;
  llmClient: OpenRouterLlmClient;
  processRepo: FirestoreProcessRepository;
  instanceRepo: FirestoreProcessInstanceRepository;
  auditRepo: FirestoreAuditRepository;
  humanTaskRepo: FirestoreHumanTaskRepository;
  agentDefinitionRepo: FirestoreAgentDefinitionRepository;
  coworkSessionRepo: FirestoreCoworkSessionRepository;
  cronTriggerStateRepo: CronTriggerStateRepository;
}

export function getPlatformServices(): PlatformServices {
  if (services) return services;

  // Fail fast if the encryption key is missing or malformed — better to crash here
  // than to boot successfully and fail opaquely mid-workflow.
  validateSecretsKey();

  // Initialize platform Firebase project (env vars set in platform-ui)
  initializeFirebase({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });

  const db = getFirestoreDb();

  // Connect to Firestore emulator on the server side when running locally
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    try {
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    } catch {
      // Already connected — safe to ignore
    }
  }

  const processRepo = new FirestoreProcessRepository(db);
  const instanceRepo = new FirestoreProcessInstanceRepository(db);
  const auditRepo = new FirestoreAuditRepository(db);
  const agentRunRepo = new FirestoreAgentRunRepository(db);
  const humanTaskRepo = new FirestoreHumanTaskRepository(db);
  const agentDefinitionRepo = new FirestoreAgentDefinitionRepository();
  const coworkSessionRepo = new FirestoreCoworkSessionRepository(db);
  const cronTriggerStateRepo = new FirestoreCronTriggerStateRepository(db);
  const eventLog = new FirestoreAgentEventLog(db);

  const pluginRegistry = new PluginRegistry();

  // Register supply intelligence plugins from @mediforce/supply-intelligence-plugins.
  registerSupplyIntelligencePlugins(pluginRegistry);

  // Register Claude Code agent plugin for protocol-to-tfl and other Claude-driven workflows.
  // MOCK_AGENT=true → use mock plugin that returns fixture data instantly (for UAT)
  const useMockAgent = process.env.MOCK_AGENT === 'true';
  if (useMockAgent) {
    console.log('[platform-services] MOCK_AGENT=true — using MockClaudeCodeAgentPlugin');
  }
  pluginRegistry.register(
    'claude-code-agent',
    useMockAgent ? new MockClaudeCodeAgentPlugin() : new ClaudeCodeAgentPlugin(),
  );

  // Register OpenCode agent plugin — supports multiple providers including local models (Ollama).
  // Uses the same MOCK_AGENT env var for mock mode (handled by base class).
  pluginRegistry.register('opencode-agent', new OpenCodeAgentPlugin());

  // Register script container plugin — runs deterministic scripts in Docker (no LLM).
  pluginRegistry.register('script-container', new ScriptContainerPlugin());

  const llmClient = new OpenRouterLlmClient(
    process.env.OPENROUTER_API_KEY ?? '',
    'anthropic/claude-sonnet-4',
  );

  const engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined, // rbacService
    undefined, // handoffRepository
    undefined, // notificationService
    humanTaskRepo, // humanTaskRepository — enables HumanTask creation on human step advance
    coworkSessionRepo, // coworkSessionRepository — enables CoworkSession creation on cowork step advance
  );

  const agentRunner = new AgentRunner(
    instanceRepo,
    auditRepo,
    eventLog,
    agentRunRepo,
  );

  services = {
    engine,
    manualTrigger: new ManualTrigger(engine),
    cronTrigger: new CronTrigger(engine),
    agentRunner,
    pluginRegistry,
    llmClient,
    processRepo,
    instanceRepo,
    auditRepo,
    humanTaskRepo,
    agentDefinitionRepo,
    coworkSessionRepo,
    cronTriggerStateRepo,
  };

  if (!seedingStarted) {
    seedingStarted = true;
    seedBuiltinAgentDefinitions(agentDefinitionRepo).catch((err) => {
      console.error('[platform-services] Failed to seed built-in agent definitions:', err);
    });
  }

  return services;
}

/** Base URL for internal server-to-server calls (e.g. auto-runner trigger).
 *  Reads NEXT_PUBLIC_APP_URL, falls back to localhost with PORT env var. */
export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
}
