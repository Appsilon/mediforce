import { z } from 'zod';

export const SECRET_VALUE_MAX_BYTES = 65_536;

export const SetSecretInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1).optional(),
  key: z.string().min(1).max(256),
  value: z.string().min(1).max(SECRET_VALUE_MAX_BYTES),
});

export const ListSecretKeysInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1).optional(),
});

export const ListSecretKeysOutputSchema = z.object({
  keys: z.array(z.string()),
});

export const DeleteSecretInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1).optional(),
  key: z.string().min(1),
});

export const DeleteSecretOutputSchema = z.object({
  ok: z.literal(true),
});

export const SetSecretOutputSchema = z.object({
  ok: z.literal(true),
});

export const GetWorkflowSecretsFullInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1),
});

export const GetWorkflowSecretsFullOutputSchema = z.object({
  secrets: z.record(z.string(), z.string()),
});

export const SaveWorkflowSecretsInputSchema = z.object({
  namespace: z.string().min(1),
  workflow: z.string().min(1),
  secrets: z.record(z.string().min(1).max(256), z.string().max(SECRET_VALUE_MAX_BYTES)),
});

export const SaveWorkflowSecretsOutputSchema = z.object({
  ok: z.literal(true),
  savedKeyCount: z.number().int().nonnegative(),
});

export type SetSecretInput = z.infer<typeof SetSecretInputSchema>;
export type SetSecretOutput = z.infer<typeof SetSecretOutputSchema>;
export type ListSecretKeysInput = z.infer<typeof ListSecretKeysInputSchema>;
export type ListSecretKeysOutput = z.infer<typeof ListSecretKeysOutputSchema>;
export type DeleteSecretInput = z.infer<typeof DeleteSecretInputSchema>;
export type DeleteSecretOutput = z.infer<typeof DeleteSecretOutputSchema>;
export type GetWorkflowSecretsFullInput = z.infer<typeof GetWorkflowSecretsFullInputSchema>;
export type GetWorkflowSecretsFullOutput = z.infer<typeof GetWorkflowSecretsFullOutputSchema>;
export type SaveWorkflowSecretsInput = z.infer<typeof SaveWorkflowSecretsInputSchema>;
export type SaveWorkflowSecretsOutput = z.infer<typeof SaveWorkflowSecretsOutputSchema>;

// ---- GET /api/workspace-secrets/previews?namespace=… ------------------------
// Returns masked previews for the workspace secrets editor. Workspace-scope
// only — workflow-secrets editor reveals plaintext via the values endpoint.
export const GetWorkspaceSecretPreviewsInputSchema = z.object({
  namespace: z.string().min(1),
});

export const SecretPreviewSchema = z.object({
  key: z.string(),
  preview: z.string(),
});

export const GetWorkspaceSecretPreviewsOutputSchema = z.object({
  previews: z.array(SecretPreviewSchema),
});

export type GetWorkspaceSecretPreviewsInput = z.infer<typeof GetWorkspaceSecretPreviewsInputSchema>;
export type SecretPreview = z.infer<typeof SecretPreviewSchema>;
export type GetWorkspaceSecretPreviewsOutput = z.infer<typeof GetWorkspaceSecretPreviewsOutputSchema>;

// ---- GET /api/workflow-secrets/keys-batch?namespace=…&workflow=A&workflow=B -
// Bulk key-listing across N workflows in one round-trip. Powers the workflow
// row's "configured-keys" indicator on the run launcher.
export const ListWorkflowSecretKeysBatchInputSchema = z.object({
  namespace: z.string().min(1),
  workflows: z.array(z.string().min(1)).min(1).max(50),
});

export const ListWorkflowSecretKeysBatchOutputSchema = z.object({
  keysByWorkflow: z.record(z.string(), z.array(z.string())),
});

export type ListWorkflowSecretKeysBatchInput = z.infer<
  typeof ListWorkflowSecretKeysBatchInputSchema
>;
export type ListWorkflowSecretKeysBatchOutput = z.infer<
  typeof ListWorkflowSecretKeysBatchOutputSchema
>;
