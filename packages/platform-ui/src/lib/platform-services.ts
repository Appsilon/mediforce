// packages/platform-ui/src/lib/platform-services.ts
import {
  FirestoreProcessRepository,
  FirestoreProcessInstanceRepository,
  FirestoreAuditRepository,
  FirestoreAgentRunRepository,
  FirestoreHumanTaskRepository,
  initializeFirebase,
  getFirestoreDb,
} from '@mediforce/platform-infra';
import { connectFirestoreEmulator } from 'firebase/firestore';
import {
  WorkflowEngine,
  GateRegistry,
  alwaysProceed,
  ManualTrigger,
} from '@mediforce/workflow-engine';
import {
  AgentRunner,
  PluginRegistry,
  OpenRouterLlmClient,
  FirestoreAgentEventLog,
  ClaudeCodeAgentPlugin,
} from '@mediforce/agent-runtime';
import { NoOpGateErrorNotifier } from '@mediforce/platform-core';
import { registerSupplyIntelligencePlugins } from '@mediforce/supply-intelligence-plugins';

let services: PlatformServices | null = null;

export interface PlatformServices {
  engine: WorkflowEngine;
  manualTrigger: ManualTrigger;
  agentRunner: AgentRunner;
  pluginRegistry: PluginRegistry;
  llmClient: OpenRouterLlmClient;
  processRepo: FirestoreProcessRepository;
  instanceRepo: FirestoreProcessInstanceRepository;
  auditRepo: FirestoreAuditRepository;
  humanTaskRepo: FirestoreHumanTaskRepository;
}

export function getPlatformServices(): PlatformServices {
  if (services) return services;

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
  const eventLog = new FirestoreAgentEventLog(db);

  const gateRegistry = new GateRegistry();
  gateRegistry.register('alwaysProceed', alwaysProceed);

  const pluginRegistry = new PluginRegistry();

  // Register supply intelligence plugins from @mediforce/supply-intelligence-plugins.
  registerSupplyIntelligencePlugins(pluginRegistry);

  // Register Claude Code agent plugin for protocol-to-tfl and other Claude-driven workflows.
  pluginRegistry.register('claude-code-agent', new ClaudeCodeAgentPlugin());

  const llmClient = new OpenRouterLlmClient(
    process.env.OPENROUTER_API_KEY ?? '',
    'anthropic/claude-sonnet-4',
  );

  const engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    gateRegistry,
    new NoOpGateErrorNotifier(),
    undefined, // rbacService
    undefined, // handoffRepository
    undefined, // notificationService
    humanTaskRepo, // humanTaskRepository — enables HumanTask creation on human step advance
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
    agentRunner,
    pluginRegistry,
    llmClient,
    processRepo,
    instanceRepo,
    auditRepo,
    humanTaskRepo,
  };

  return services;
}

// API key validation helper — shared API key for cross-app server-to-server auth
export function validateApiKey(request: Request): boolean {
  const key = request.headers.get('X-Api-Key');
  return key !== null && key === process.env.PLATFORM_API_KEY;
}
