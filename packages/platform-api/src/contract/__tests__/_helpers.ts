import type { WorkflowDefinition } from '@mediforce/platform-core';

/**
 * Strip the server-managed fields (`version`, `namespace`, `createdAt`) from a
 * `WorkflowDefinition` to produce the body shape that
 * `RegisterWorkflowInputSchema` accepts on the wire.
 *
 * The server fills these three fields in itself: `version` from
 * auto-increment, `namespace` from the query param, `createdAt` stamped at
 * write time. Tests that build a full `WorkflowDefinition` (e.g. via
 * `buildWorkflowDefinition`) and want to send it through the register path
 * must omit them first.
 *
 * Lives in a tests-only file so production code never imports it.
 */
export function omitServerFields(
  wd: WorkflowDefinition,
): Omit<WorkflowDefinition, 'version' | 'namespace' | 'createdAt'> {
  const { version: _version, namespace: _namespace, createdAt: _createdAt, ...body } = wd;
  void _version;
  void _namespace;
  void _createdAt;
  return body;
}
