'use client';

/**
 * Legacy ProcessConfig list component -- processConfigs collection has been removed.
 * Process configurations are now embedded directly in WorkflowDefinition steps.
 * This component is kept as a stub in case it is referenced from other code.
 */

interface ConfigListProps {
  processName: string;
}

export function ConfigList({ processName }: ConfigListProps) {
  void processName;
  return (
    <div className="text-center py-12 text-sm text-muted-foreground">
      <p>Process configurations are now embedded in workflow definitions.</p>
    </div>
  );
}
