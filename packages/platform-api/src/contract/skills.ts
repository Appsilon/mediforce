import { z } from 'zod';
import {
  SkillFilesSchema,
  SkillSchema,
  SkillSummarySchema,
  SkillVisibilitySchema,
} from '@mediforce/platform-core';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });
const SkillRef = NamespaceQuery.extend({ id: z.string().min(1) });

/** `includePublic` adds every other workspace's public Skills after the
 *  namespace's own: the Skills an Agent of that workspace may hold. */
export const ListSkillsInputSchema = NamespaceQuery.extend({
  includePublic: z.boolean().optional(),
});
export const ListSkillsOutputSchema = z.object({
  skills: z.array(SkillSummarySchema),
});

export const GetSkillInputSchema = SkillRef;
export const GetSkillOutputSchema = z.object({ skill: SkillSchema });

/** POST input. `id`, `name` and `description` are read from `SKILL.md`, never
 *  sent beside it, so strict mode refuses them rather than ignoring them. */
export const CreateSkillInputSchema = NamespaceQuery.extend({
  files: SkillFilesSchema,
  visibility: SkillVisibilitySchema.optional(),
}).strict();
export const CreateSkillOutputSchema = z.object({ skill: SkillSchema });

/** PATCH input: id from the URL. `files` replaces the whole set; its
 *  `SKILL.md` must still name this skill, since a rename is a new Skill. */
export const UpdateSkillInputSchema = SkillRef.extend({
  files: SkillFilesSchema.optional(),
  visibility: SkillVisibilitySchema.optional(),
}).strict().refine(
  (input) => input.files !== undefined || input.visibility !== undefined,
  'send files, visibility or both: an empty patch changes nothing',
);
export const UpdateSkillOutputSchema = z.object({ skill: SkillSchema });

export const DeleteSkillInputSchema = SkillRef;
export const DeleteSkillOutputSchema = z.object({ success: z.literal(true) });

export type ListSkillsInput = z.infer<typeof ListSkillsInputSchema>;
export type ListSkillsOutput = z.infer<typeof ListSkillsOutputSchema>;
export type GetSkillInput = z.infer<typeof GetSkillInputSchema>;
export type GetSkillOutput = z.infer<typeof GetSkillOutputSchema>;
export type CreateSkillInput = z.infer<typeof CreateSkillInputSchema>;
export type CreateSkillOutput = z.infer<typeof CreateSkillOutputSchema>;
export type UpdateSkillInput = z.infer<typeof UpdateSkillInputSchema>;
export type UpdateSkillOutput = z.infer<typeof UpdateSkillOutputSchema>;
export type DeleteSkillInput = z.infer<typeof DeleteSkillInputSchema>;
export type DeleteSkillOutput = z.infer<typeof DeleteSkillOutputSchema>;
