import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { WorkflowArtifactSchema, validateFileTree, type WorkflowArtifact } from './workflow-definition';

/**
 * A Skill (ADR-0025): a Claude Code skill folder stored as a workspace
 * resource. `SKILL.md` sits at its root and opens with YAML frontmatter that
 * names and describes it; every other file is text beside it. `id` and
 * `description` are read from that frontmatter, never supplied separately, so
 * the stored row and the folder Claude Code reads cannot disagree.
 */

const SKILL_MANIFEST_PATH = 'SKILL.md';

export const SkillVisibilitySchema = z.enum(['private', 'public']);
export type SkillVisibility = z.infer<typeof SkillVisibilitySchema>;

/** Claude Code resolves a skill by its directory name and expects it to equal
 *  `name`, so `name` has to be a valid directory name in its own format. */
const SkillNameSchema = z.string()
  .min(1, 'name is required')
  .max(64, 'name is longer than 64 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'name must be kebab-case: lowercase letters, digits and single hyphens');

const SkillFrontmatterSchema = z.object({
  name: SkillNameSchema,
  description: z.string().trim().min(1, 'description is required').max(1024, 'description is longer than 1024 characters'),
});
type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type FrontmatterResult =
  | { success: true; data: SkillFrontmatter }
  | { success: false; message: string };

/** Read `name` and `description` from a `SKILL.md`. */
export function parseSkillFrontmatter(markdown: string): FrontmatterResult {
  const match = FRONTMATTER.exec(markdown);
  if (match === null) {
    return { success: false, message: `${SKILL_MANIFEST_PATH} must open with YAML frontmatter between '---' lines` };
  }
  let yaml: unknown;
  try {
    yaml = parseYaml(match[1] ?? '');
  } catch (error) {
    return { success: false, message: `${SKILL_MANIFEST_PATH} frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = SkillFrontmatterSchema.safeParse(yaml ?? {});
  if (parsed.success === false) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') ?? '';
    return { success: false, message: `${SKILL_MANIFEST_PATH} frontmatter ${field === '' ? '' : `'${field}' `}is invalid: ${issue?.message ?? 'unknown error'}` };
  }
  return { success: true, data: parsed.data };
}

/**
 * The files of one Skill. Paths follow {@link WorkflowArtifactSchema}, the set
 * passes the same file-tree checks a workflow's artifacts do, and it must hold
 * a `SKILL.md` at its root whose frontmatter parses.
 */
export const SkillFilesSchema = z.array(WorkflowArtifactSchema).superRefine((files, ctx) => {
  validateFileTree(files, [], ctx, 'a skill is text an agent reads, so keep large data out of it');
  const manifest = files.find((file) => file.path === SKILL_MANIFEST_PATH);
  if (manifest === undefined) {
    ctx.addIssue({ code: 'custom', message: `a skill needs a ${SKILL_MANIFEST_PATH} at its root` });
    return;
  }
  const frontmatter = parseSkillFrontmatter(manifest.contents);
  if (frontmatter.success === false) {
    ctx.addIssue({ code: 'custom', path: [files.indexOf(manifest), 'contents'], message: frontmatter.message });
  }
});
export type SkillFile = WorkflowArtifact;

/** `name` and `description` of a file set {@link SkillFilesSchema} accepted. */
export function skillManifest(files: ReadonlyArray<SkillFile>): SkillFrontmatter {
  const manifest = files.find((file) => file.path === SKILL_MANIFEST_PATH);
  if (manifest === undefined) throw new Error(`a skill needs a ${SKILL_MANIFEST_PATH} at its root`);
  const frontmatter = parseSkillFrontmatter(manifest.contents);
  if (frontmatter.success === false) throw new Error(frontmatter.message);
  return frontmatter.data;
}

export const SkillSchema = z.object({
  namespace: z.string().min(1),
  /** The frontmatter `name`. Fixed at create; a rename is a new Skill. */
  id: SkillNameSchema,
  name: SkillNameSchema,
  description: z.string().min(1),
  visibility: SkillVisibilitySchema.default('private'),
  /** sha256 over `files`, recomputed on every write. */
  contentHash: z.string().min(1),
  files: SkillFilesSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

/** A Skill without its file contents — what a listing returns. */
export const SkillSummarySchema = SkillSchema.omit({ files: true }).extend({
  paths: z.array(z.string()),
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
