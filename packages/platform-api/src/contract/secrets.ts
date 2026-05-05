import { z } from 'zod';

export const SetSecretInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
});

export const ListSecretKeysInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1),
});

export const ListSecretKeysOutputSchema = z.object({
  keys: z.array(z.string()),
});

export const DeleteSecretInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1),
  key: z.string().min(1),
});

export const DeleteSecretOutputSchema = z.object({
  ok: z.literal(true),
});

export const SetSecretOutputSchema = z.object({
  ok: z.literal(true),
});

export type SetSecretInput = z.infer<typeof SetSecretInputSchema>;
export type SetSecretOutput = z.infer<typeof SetSecretOutputSchema>;
export type ListSecretKeysInput = z.infer<typeof ListSecretKeysInputSchema>;
export type ListSecretKeysOutput = z.infer<typeof ListSecretKeysOutputSchema>;
export type DeleteSecretInput = z.infer<typeof DeleteSecretInputSchema>;
export type DeleteSecretOutput = z.infer<typeof DeleteSecretOutputSchema>;
