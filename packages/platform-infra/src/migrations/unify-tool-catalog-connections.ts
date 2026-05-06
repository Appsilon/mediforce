import {
  type AgentDefinitionRepository,
  type AgentMcpBindingMap,
  type AgentOAuthTokenRepository,
  type Connection,
  type ConnectionRepository,
  type CreateConnectionInput,
  type ToolCatalogEntry,
  type ToolCatalogRepository,
} from '@mediforce/platform-core';

export interface MigrationDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
  toolCatalogRepo: ToolCatalogRepository;
  agentOAuthTokenRepo: AgentOAuthTokenRepository;
  connectionRepo: ConnectionRepository;
}

export interface MigrationReport {
  /** Connections created during this run (idempotent — repeat runs report 0). */
  createdConnections: number;
  /** Catalog entries created — one per migrated http binding. */
  createdCatalogEntries: number;
  /** Agent bindings rewritten from inline shape to catalog-ref shape. */
  rewrittenBindings: number;
  /** Token docs whose contents were copied onto a Connection's auth. */
  migratedTokens: number;
  /** Bindings the migration could not handle (logged per namespace + skipped). */
  skipped: Array<{ namespace: string; agentId: string; serverName: string; reason: string }>;
}

/** Idempotent migration: lift every legacy http MCP binding into a
 *  Connection + ToolCatalogEntry pair, then copy each `agent-oauth-token`
 *  document onto its target Connection.
 *
 *  Determinism — ids per binding:
 *    Connection id   : `<agentId>-<serverName>` (lowercased + sanitized)
 *    Catalog entry id: `<agentId>-<serverName>-mcp` for the catalog-ref binding
 *
 *  IDs are namespaced by agentId so two agents that share a server name
 *  (e.g. both call their GitHub server `github`) get distinct Connections
 *  with distinct tokens — no silent cross-agent token sharing. Admins
 *  consolidate redundant Connections later through the UI.
 *
 *  Idempotency: every step checks for prior run output and skips.
 *
 *  Lossy: stdio bindings whose env contains `{{SECRET:x}}` patterns are
 *  NOT extracted into Connections — that path is a follow-up. We log them
 *  in the report so admins can see what work remains.
 *
 *  This function expects a per-namespace caller. The caller should iterate
 *  every namespace and pass the right scoped repos. */
export async function migrateNamespaceConnections(
  namespace: string,
  deps: MigrationDeps,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    createdConnections: 0,
    createdCatalogEntries: 0,
    rewrittenBindings: 0,
    migratedTokens: 0,
    skipped: [],
  };

  // Agent definitions are global today (no namespace field). Token storage
  // and catalog entries live per-namespace, so the migration is keyed by
  // (namespace × agent × serverName). Subsequent namespaces find the
  // binding already rewritten and skip the agent rewrite step.
  const agents = await deps.agentDefinitionRepo.list();

  for (const agent of agents) {
    const bindings = (agent.mcpServers ?? {}) as AgentMcpBindingMap;
    let mutated = false;
    const newBindings: AgentMcpBindingMap = { ...bindings };

    for (const [serverName, binding] of Object.entries(bindings)) {
      // Skip already-migrated bindings (catalog-ref shape).
      if (binding.type === 'catalog') continue;

      // Skip stdio bindings — they already use catalogId; nothing to lift
      // unless the catalog entry itself routes auth through env templates,
      // which the design decision says we leave for a follow-up.
      if (binding.type === 'stdio') continue;

      // HTTP binding — the real work.
      if (binding.type !== 'http') continue;

      const auth = binding.auth;
      const providerId = auth?.type === 'oauth' ? auth.provider : null;

      // Build deterministic ids — namespaced by agentId so two agents that
      // share a server name don't silently coalesce onto one Connection.
      const connectionId = sanitizeId(`${agent.id}-${serverName}`);
      const catalogId = `${connectionId}-mcp`;

      // Create Connection if not present. Prefer oauth shape when binding
      // had oauth auth; fall back to a headers connection that mirrors the
      // template values verbatim.
      const existingConnection = await deps.connectionRepo.getById(namespace, connectionId);
      if (existingConnection === null) {
        const connectionInput = buildConnectionInput({
          connectionId,
          serverName,
          auth,
          providerId,
        });
        if (connectionInput === null) {
          report.skipped.push({
            namespace,
            agentId: agent.id,
            serverName,
            reason: 'http binding has no recognized auth shape',
          });
          continue;
        }
        await deps.connectionRepo.create(namespace, connectionInput);
        report.createdConnections += 1;
      }

      // Create the catalog entry if not present.
      const existingCatalog = await deps.toolCatalogRepo.getById(namespace, catalogId);
      if (existingCatalog === null) {
        const catalogEntry: ToolCatalogEntry = {
          id: catalogId,
          name: `${serverName} (migrated)`,
          connectionId,
          mcp: { type: 'http', url: binding.url },
        };
        await deps.toolCatalogRepo.upsert(namespace, catalogEntry);
        report.createdCatalogEntries += 1;
      }

      // Copy tokens, if any, onto the Connection's auth.
      if (providerId !== null) {
        const token = await deps.agentOAuthTokenRepo.get(namespace, agent.id, serverName);
        if (token !== null) {
          // setTokens throws when the connection isn't oauth-typed; we set
          // it to oauth above for any provider-id'd binding so this is safe.
          // Token-update schema requires non-empty strings on optional fields.
          // Older agent-oauth-token rows occasionally landed with empty
          // strings (pre-validation era); drop those before passing through
          // so the schema doesn't reject otherwise-valid rows.
          const cleanToken = {
            accessToken: token.accessToken,
            ...(typeof token.refreshToken === 'string' && token.refreshToken !== ''
              ? { refreshToken: token.refreshToken }
              : {}),
            ...(typeof token.expiresAt === 'number' && token.expiresAt > 0
              ? { expiresAt: token.expiresAt }
              : {}),
            ...(typeof token.scope === 'string' && token.scope !== ''
              ? { scope: token.scope }
              : {}),
            ...(typeof token.providerUserId === 'string' && token.providerUserId !== ''
              ? { providerUserId: token.providerUserId }
              : {}),
            ...(typeof token.accountLogin === 'string' && token.accountLogin !== ''
              ? { accountLogin: token.accountLogin }
              : {}),
            ...(typeof token.connectedBy === 'string' && token.connectedBy !== ''
              ? { connectedBy: token.connectedBy }
              : {}),
          };
          try {
            await deps.connectionRepo.setTokens(namespace, connectionId, cleanToken);
            report.migratedTokens += 1;
          } catch (err) {
            report.skipped.push({
              namespace,
              agentId: agent.id,
              serverName,
              reason: `token copy failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }

      // Rewrite the agent binding to catalog-ref shape.
      newBindings[serverName] = {
        type: 'catalog',
        catalogId,
        ...(binding.allowedTools !== undefined && binding.allowedTools.length > 0
          ? { allowedTools: binding.allowedTools }
          : {}),
      };
      mutated = true;
      report.rewrittenBindings += 1;
    }

    if (mutated) {
      await deps.agentDefinitionRepo.update(agent.id, { mcpServers: newBindings });
    }
  }

  return report;
}

function sanitizeId(raw: string): string {
  // Lowercase, replace non-alphanumeric runs with single dashes, strip
  // leading/trailing dashes, prefix with letter when a digit comes first.
  // Empty input (or all-symbol input that collapses to '') would produce
  // an invalid id; fall back to a stable placeholder so the schema never
  // sees an empty slug.
  const lower = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (lower === '') return 'unnamed';
  return /^[a-z]/.test(lower) ? lower : `c-${lower}`;
}

function buildConnectionInput(params: {
  connectionId: string;
  serverName: string;
  auth:
    | { type: 'headers'; headers: Record<string, string> }
    | { type: 'oauth'; provider: string; headerName?: string; headerValueTemplate?: string }
    | undefined;
  providerId: string | null;
}): CreateConnectionInput | null {
  const { connectionId, serverName, auth, providerId } = params;
  const name = `${serverName} (migrated)`;

  if (providerId !== null) {
    return {
      id: connectionId,
      name,
      auth: { type: 'oauth', providerId },
    };
  }

  if (auth?.type === 'headers') {
    return {
      id: connectionId,
      name,
      auth: { type: 'headers', headers: auth.headers },
    };
  }

  return null;
}

/** Workspace `Connection` shape for log/audit purposes. Re-exported so
 *  external scripts that drive the migration can pretty-print the
 *  resulting connection records. */
export type MigratedConnection = Connection;
