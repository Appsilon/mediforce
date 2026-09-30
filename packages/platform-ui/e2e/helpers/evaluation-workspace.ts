import { PostgresNamespaceSecretsRepository, createPostgresClient } from '@mediforce/platform-infra';
import { TEST_USER_ID } from './constants';
import { seedPostgresOrganizationNamespace } from './postgres-seed';

/**
 * The workspace the Evaluation Assistant journeys work in. Its own, because
 * the assistant needs an `OPENROUTER_API_KEY` workspace secret and other
 * journeys assert that the shared test workspace has none. The key is a dummy:
 * every model call goes to the scripted mock (helpers/mock-openrouter-server.ts).
 */
export const EVALUATION_WORKSPACE = 'eval-assistant-e2e';

export async function seedEvaluationWorkspace(): Promise<void> {
  await seedPostgresOrganizationNamespace(EVALUATION_WORKSPACE, TEST_USER_ID, 'Evaluation Assistant E2E');
  const { client, db } = createPostgresClient();
  try {
    await new PostgresNamespaceSecretsRepository(db).setSecrets(EVALUATION_WORKSPACE, { OPENROUTER_API_KEY: 'sk-mock-openrouter' });
  } finally {
    await client.end({ timeout: 5 });
  }
}
