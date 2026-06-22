export interface WorkflowSecretsRepository {
  getSecrets(namespace: string, workflowName: string): Promise<Record<string, string>>;
  getSecretKeys(namespace: string, workflowName: string): Promise<string[]>;
  setSecrets(namespace: string, workflowName: string, secrets: Record<string, string>): Promise<void>;
  deleteSecrets(namespace: string, workflowName: string): Promise<void>;
  deleteSecret(namespace: string, workflowName: string, key: string): Promise<void>;
  upsertSecret(namespace: string, workflowName: string, key: string, value: string): Promise<void>;
}
