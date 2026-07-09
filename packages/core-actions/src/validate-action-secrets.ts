const SECRET_REF_RE = /\$\{secrets\.([^}]+)\}/g;

function extractSecretNames(value: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof value === 'string') {
    for (const match of value.matchAll(SECRET_REF_RE)) {
      names.add(match[1]);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      for (const name of extractSecretNames(item)) {
        names.add(name);
      }
    }
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      for (const name of extractSecretNames(v)) {
        names.add(name);
      }
    }
  }
  return names;
}

export interface MissingActionSecret {
  secretName: string;
  steps: Array<{ stepId: string; stepName: string }>;
}

export function validateActionSecrets(
  steps: Array<{ id: string; name: string; executor: string; action?: { kind: string; config: unknown } }>,
  workflowSecrets: Record<string, string>,
): MissingActionSecret[] {
  const missingMap = new Map<string, MissingActionSecret>();

  for (const step of steps) {
    if (step.executor !== 'action' || !step.action) continue;

    const secretNames = extractSecretNames(step.action.config);
    for (const name of secretNames) {
      if (name in workflowSecrets && workflowSecrets[name] !== '') continue;

      if (!missingMap.has(name)) {
        missingMap.set(name, { secretName: name, steps: [] });
      }
      missingMap.get(name)!.steps.push({ stepId: step.id, stepName: step.name });
    }
  }

  return Array.from(missingMap.values());
}
