import { getStorage } from 'firebase-admin/storage';
import type { AgentDefinitionRepository } from '@mediforce/platform-core';

export const MAX_SKILL_FILE_BYTES = 100 * 1024; // 100 KB

export interface SkillDownloadWarning {
  path: string;
  reason: string;
}

export interface ResolveResult {
  prompt: string | undefined;
  warnings: SkillDownloadWarning[];
}

/**
 * Resolve the agent identity prompt from an AgentDefinition:
 * assembles systemPrompt + downloaded skill file contents into a single string
 * injected into the agent's prompt after the workflow preamble.
 *
 * Returns undefined prompt when the agent has no systemPrompt and no skills.
 * Returns warnings for any skills that could not be loaded.
 */
export async function resolveAgentIdentityPrompt(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<string | undefined> {
  const { prompt } = await resolveAgentIdentity(agentId, agentDefinitionRepo);
  return prompt;
}

export async function resolveAgentIdentity(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<ResolveResult> {
  const agent = await agentDefinitionRepo.getById(agentId);
  if (!agent) return { prompt: undefined, warnings: [] };

  const parts: string[] = [];
  const warnings: SkillDownloadWarning[] = [];

  if (agent.systemPrompt) {
    parts.push(`## Agent Identity\n\n${agent.systemPrompt}`);
  }

  if (agent.skillFileNames.length > 0) {
    const { contents, warnings: dlWarnings } = await downloadSkillFiles(agent.skillFileNames);
    warnings.push(...dlWarnings);
    if (contents.length > 0) {
      parts.push(`## Skills\n\n${contents.join('\n\n---\n\n')}`);
    }
  }

  return {
    prompt: parts.length > 0 ? parts.join('\n\n') : undefined,
    warnings,
  };
}

interface DownloadResult {
  contents: string[];
  warnings: SkillDownloadWarning[];
}

export async function downloadSkillFiles(paths: string[]): Promise<DownloadResult> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    return {
      contents: [],
      warnings: paths.map((path) => ({
        path,
        reason: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET not set — skill files cannot be loaded',
      })),
    };
  }

  const bucket = getStorage().bucket(bucketName);
  const warnings: SkillDownloadWarning[] = [];

  const settled = await Promise.allSettled(
    paths.map(async (storagePath) => {
      const file = bucket.file(storagePath);
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (size > MAX_SKILL_FILE_BYTES) {
        throw new Error(
          `File exceeds ${MAX_SKILL_FILE_BYTES / 1024}KB limit (${Math.round(size / 1024)}KB)`,
        );
      }
      const [buffer] = await file.download();
      return { path: storagePath, content: buffer.toString('utf-8').trim() };
    }),
  );

  const contents: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      if (result.value.content.length > 0) {
        contents.push(result.value.content);
      }
    } else {
      const failedPath = paths[settled.indexOf(result)];
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push({ path: failedPath, reason });
    }
  }

  return { contents, warnings };
}
