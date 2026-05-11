import { z } from 'zod';
import { RepoSchema } from './process-definition.js';

/** Path safety: characters allowed inside a Registry path component or an
 *  agent skill reference. Excludes `\0`, shell metacharacters, and leading
 *  dots that could lead to a `..` traversal segment. Forward slashes ARE
 *  allowed (migration uses `<agentId>/<stem>` as the skill name), but
 *  individual segments are validated against `..` below. */
const SAFE_PATH_RE = /^[a-zA-Z0-9_\-./]+$/;

function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (!SAFE_PATH_RE.test(value)) return false;
  if (value.startsWith('/')) return false;
  if (value.endsWith('/')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '..' && segment !== '.');
}

const RelativePathSchema = z
  .string()
  .min(1)
  .refine(isSafeRelativePath, {
    message: 'must be a relative path without ".." / "." segments and only [A-Za-z0-9_\\-./] characters',
  });

export const SkillRegistrySchema = z.object({
  id: z.string(),
  /** Human-readable label, e.g. "SDTM skills". */
  name: z.string().min(1),
  /** Reused process-definition Repo shape (url + commit + optional auth). */
  repo: RepoSchema,
  /** Path within the repo that contains skill folders, e.g. "skills".
   *  Constrained to relative path segments — protects the runtime
   *  `fetchSkillsCache` / `resolveAgentSkills` `join()`s from path
   *  traversal attempts via a Registry record. */
  skillsDir: RelativePathSchema,
  /** Workspace scoping. Required — registries are always owned by a
   *  workspace. Sharing across workspaces is a deferred follow-up
   *  (per agent-skills.md §4). */
  namespace: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SkillRegistry = z.infer<typeof SkillRegistrySchema>;

export const CreateSkillRegistryInputSchema = SkillRegistrySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/** PATCH body — partial of CreateSkillRegistryInput, but `namespace` is
 *  intentionally NOT mutable: moving a registry to a different namespace
 *  would let a caller with mutation rights in namespace A relocate the
 *  record into namespace B (which they may not control). Namespace
 *  changes require explicit recreation. */
export const UpdateSkillRegistryInputSchema = CreateSkillRegistryInputSchema
  .omit({ namespace: true })
  .partial();

export type CreateSkillRegistryInput = z.infer<typeof CreateSkillRegistryInputSchema>;
export type UpdateSkillRegistryInput = z.infer<typeof UpdateSkillRegistryInputSchema>;

export const AgentSkillRefSchema = z.object({
  registryId: z.string().min(1),
  /** Skill folder path under `<registry.repo>/<registry.skillsDir>/`.
   *  Constrained to relative-path segments to keep runtime `cpSync`
   *  inside the per-run plugin dir. Migration script uses the
   *  `<agentId>/<filename-stem>` form, hence forward slashes are
   *  permitted but `..` segments are not. */
  name: RelativePathSchema,
});

export type AgentSkillRef = z.infer<typeof AgentSkillRefSchema>;
