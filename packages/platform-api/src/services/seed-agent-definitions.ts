import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentDefinitionRepository,
  CreateAgentDefinitionInput,
  ModelRegistryRepository,
} from '@mediforce/platform-core';
import { CreateAgentDefinitionInputSchema, DEFAULT_MODEL, pinDefaultModel } from '@mediforce/platform-core';

/** Deterministic slug → AgentDefinition body. Slug doubles as Firestore
 *  doc id so wd.json files can reference it via step.agentId without
 *  fear of IDs shifting between environments.
 *
 *  Authoritative data lives in data/seeds/agent-definitions.json (shared
 *  with scripts/seed_agent_definitions.py). Validated on load so schema
 *  drift in the JSON surfaces at startup, not at the first call site.
 *
 *  Idempotent: only writes when the doc is missing — user edits via the
 *  Agents UI are preserved across restarts. A seed on `DEFAULT_MODEL` is
 *  pinned to the concrete model the registry resolves it to at write time. */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/platform-ui/src/lib -> repo root (4 levels up)
const SEED_PATH = resolve(__dirname, '../../../../data/seeds/agent-definitions.json');

function loadBuiltinAgents(): Record<string, CreateAgentDefinitionInput> {
  const raw = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Record<string, unknown>;
  const result: Record<string, CreateAgentDefinitionInput> = {};
  for (const [id, body] of Object.entries(raw)) {
    result[id] = CreateAgentDefinitionInputSchema.parse(body);
  }
  return result;
}

const BUILTIN_AGENTS = loadBuiltinAgents();

export async function seedBuiltinAgentDefinitions(
  repo: AgentDefinitionRepository,
  modelRegistryRepo: ModelRegistryRepository,
): Promise<void> {
  const pinnedDefault = pinDefaultModel(await modelRegistryRepo.list());
  await Promise.all(
    Object.entries(BUILTIN_AGENTS).map(async ([id, body]) => {
      const existing = await repo.getById(id);
      if (existing === null) {
        await repo.upsert(id, body.foundationModel === DEFAULT_MODEL ? { ...body, foundationModel: pinnedDefault } : body);
      }
    }),
  );
}
