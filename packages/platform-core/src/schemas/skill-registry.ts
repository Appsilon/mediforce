import { z } from 'zod';
import { RepoSchema } from './process-definition.js';

export const SkillRegistrySchema = z.object({
  id: z.string(),
  /** Human-readable label, e.g. "SDTM skills". */
  name: z.string().min(1),
  /** Reused process-definition Repo shape (url + commit + optional auth). */
  repo: RepoSchema,
  /** Path within the repo that contains skill folders, e.g. "skills". */
  skillsDir: z.string().min(1),
  /** Workspace scoping; mirrors AgentDefinition.namespace. */
  namespace: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SkillRegistry = z.infer<typeof SkillRegistrySchema>;

export const CreateSkillRegistryInputSchema = SkillRegistrySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateSkillRegistryInputSchema = CreateSkillRegistryInputSchema.partial();

export type CreateSkillRegistryInput = z.infer<typeof CreateSkillRegistryInputSchema>;
export type UpdateSkillRegistryInput = z.infer<typeof UpdateSkillRegistryInputSchema>;

export const AgentSkillRefSchema = z.object({
  registryId: z.string().min(1),
  name: z.string().min(1),
});

export type AgentSkillRef = z.infer<typeof AgentSkillRefSchema>;
