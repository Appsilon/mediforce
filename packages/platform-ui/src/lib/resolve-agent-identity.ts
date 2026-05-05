import { getStorage } from 'firebase-admin/storage';
import type { AgentDefinition, AgentDefinitionRepository } from '@mediforce/platform-core';

/**
 * Resolve the agent identity prompt from an AgentDefinition:
 * assembles systemPrompt + downloaded skill file contents into a single string
 * injected into the agent's prompt after the workflow preamble.
 *
 * Returns undefined when the agent has no systemPrompt and no skills.
 */
export async function resolveAgentIdentityPrompt(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<string | undefined> {
  const agent = await agentDefinitionRepo.getById(agentId);
  if (!agent) return undefined;

  const parts: string[] = [];

  if (agent.systemPrompt) {
    parts.push(`## Agent Identity\n\n${agent.systemPrompt}`);
  }

  if (agent.skillFileNames.length > 0) {
    const skillContents = await downloadSkillFiles(agent.skillFileNames);
    if (skillContents.length > 0) {
      parts.push(`## Skills\n\n${skillContents.join('\n\n---\n\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

async function downloadSkillFiles(paths: string[]): Promise<string[]> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    console.warn('[resolve-agent-identity] NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET not set, skipping skill download');
    return [];
  }
  const bucket = getStorage().bucket(bucketName);
  const results: string[] = [];

  for (const storagePath of paths) {
    try {
      const file = bucket.file(storagePath);
      const [buffer] = await file.download();
      const content = buffer.toString('utf-8').trim();
      if (content.length > 0) {
        results.push(content);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[resolve-agent-identity] Failed to download skill file "${storagePath}": ${message}`);
    }
  }

  return results;
}
