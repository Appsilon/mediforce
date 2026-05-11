import { z } from 'zod';

export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  keyHash: z.string().min(1),
  keyPrefix: z.string().min(1),
  label: z.string().min(1).max(128),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
}).strict();

export type ApiKey = z.infer<typeof ApiKeySchema>;

export const CreateApiKeyInputSchema = z.object({
  label: z.string().min(1).max(128),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;
