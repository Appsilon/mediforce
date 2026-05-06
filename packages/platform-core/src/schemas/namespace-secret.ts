import { z } from 'zod';

export const NamespaceSecretsSchema = z.object({
  namespace: z.string().min(1),
  secrets: z.record(z.string(), z.string()),
  updatedAt: z.string().datetime(),
});

export type NamespaceSecrets = z.infer<typeof NamespaceSecretsSchema>;
