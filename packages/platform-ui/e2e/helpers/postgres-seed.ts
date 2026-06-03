import postgres from 'postgres';
import { TEST_ORG_HANDLE } from './constants';
import { buildSeedData } from './seed-data';

/**
 * Postgres seed for the full E2E fixture (ADR-0001 §5.2 #9), invoked
 * from `auth-setup.ts` before Playwright workers start.
 *
 * Uses raw `postgres-js` rather than the `@mediforce/platform-infra` package
 * because Playwright workers don't resolve the `@mediforce/source` package
 * exports condition the way `tsx` does at type-check time — importing the
 * compiled `dist` fails because we don't build it in CI.
 *
 * Reuses `buildSeedData` so the E2E fixture and the in-memory fixture stay
 * byte-identical.
 *
 * Insert order respects FK constraints: workspaces → workflow_definitions →
 * process_instances → (step_executions + audit_events + agent_runs +
 * human_tasks + cowork_sessions + cowork_turns). agent / model_registry /
 * tool_catalog / oauth_providers depend only on workspaces.
 *
 * Idempotent: every insert uses ON CONFLICT DO NOTHING so re-running the
 * setup (e.g. after a flaky retry) does not blow up.
 */
export async function seedPostgresNamespace(
  testUserId: string,
  options: { mockOAuthBaseUrl?: string } = {},
): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to seed Postgres for E2E.');
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const data = buildSeedData(testUserId, { mockOAuthBaseUrl: options.mockOAuthBaseUrl });

    // ── 0. Wipe prior fixture rows ──────────────────────────────────────────
    // Auth-setup `clearEmulators` resets the Auth emulator but does not touch
    // Postgres, so a re-run of the setup task (Playwright retries, dev-mode
    // re-auth) would dupe human_tasks / agent_runs / audit_events (uuid PKs,
    // no business-key unique constraints) and conflict on workflow_definitions
    // (workspace, name, version) for the tenant-a / tenant-b dynamic WDs that
    // workflow-namespacing.journey created in the previous attempt. TRUNCATE
    // every fixture table with CASCADE so children are cleared transitively.
    await sql`
      TRUNCATE TABLE
        workspaces, workspace_members, workflow_definitions, workflow_meta,
        process_instances, step_executions, human_tasks, agent_runs,
        audit_events, cowork_sessions, cowork_turns, agents,
        model_registry_entries, tool_catalog_entries, oauth_providers
      RESTART IDENTITY CASCADE
    `;

    // ── 1. workspaces ───────────────────────────────────────────────────────
    // Seed the `test` workspace from the fixture, plus the dynamic tenants
    // (tenant-a / tenant-b) that `workflow-namespacing.journey` creates WDs
    // in — Postgres needs the parent rows to exist before any WD FK insert.
    const namespace = data.namespaces[TEST_ORG_HANDLE];
    if (!namespace) {
      throw new Error(`buildSeedData has no fixture for handle "${TEST_ORG_HANDLE}"`);
    }
    await sql`
      INSERT INTO workspaces (handle, type, display_name, linked_user_id, created_at)
      VALUES (
        ${namespace.handle as string},
        ${namespace.type as string},
        ${namespace.displayName as string},
        ${(namespace.linkedUserId as string | undefined) ?? null},
        ${namespace.createdAt as string}
      )
      ON CONFLICT (handle) DO NOTHING
    `;
    for (const handle of ['tenant-a', 'tenant-b']) {
      await sql`
        INSERT INTO workspaces (handle, type, display_name, created_at)
        VALUES (${handle}, 'organization', ${handle}, now())
        ON CONFLICT (handle) DO NOTHING
      `;
    }

    // ── 2. workspace_members ────────────────────────────────────────────────
    for (const member of Object.values(data.namespaceMembers)) {
      await sql`
        INSERT INTO workspace_members (workspace, uid, role, joined_at)
        VALUES (
          ${TEST_ORG_HANDLE},
          ${member.uid as string},
          ${member.role as string},
          ${member.joinedAt as string}
        )
        ON CONFLICT (workspace, uid) DO UPDATE SET
          role = EXCLUDED.role,
          joined_at = EXCLUDED.joined_at
      `;
    }

    // ── 3. workflow_definitions + workflow_meta ─────────────────────────────
    // Fixture key `<ns>:<name>:<version>` carries the same primary identity
    // as the row; the `id` column is a synthetic uuid we let Postgres mint.
    for (const wd of Object.values(data.workflowDefinitions)) {
      await sql`
        INSERT INTO workflow_definitions (
          workspace, name, version, title, description, visibility,
          steps, transitions, triggers, trigger_input, roles, env,
          notifications, git_workspace, metadata, created_at
        ) VALUES (
          ${wd.namespace as string},
          ${wd.name as string},
          ${wd.version as number},
          ${(wd.title as string | undefined) ?? null},
          ${(wd.description as string | undefined) ?? null},
          ${(wd.visibility as string | undefined) ?? 'private'},
          ${sql.json(wd.steps as unknown)},
          ${sql.json(wd.transitions as unknown)},
          ${sql.json(wd.triggers as unknown)},
          ${wd.triggerInput ? sql.json(wd.triggerInput as unknown) : null},
          ${wd.roles ? sql.json(wd.roles as unknown) : null},
          ${wd.env ? sql.json(wd.env as unknown) : null},
          ${wd.notifications ? sql.json(wd.notifications as unknown) : null},
          ${wd.workspace ? sql.json(wd.workspace as unknown) : null},
          ${wd.metadata ? sql.json(wd.metadata as unknown) : null},
          ${(wd.createdAt as string | undefined) ?? new Date().toISOString()}
        )
        ON CONFLICT (workspace, name, version) DO NOTHING
      `;
    }

    // ── 4. process_instances ────────────────────────────────────────────────
    for (const proc of Object.values(data.processInstances)) {
      await sql`
        INSERT INTO process_instances (
          id, workspace, definition_name, definition_version, status,
          current_step_id, variables, trigger_type, trigger_payload,
          pause_reason, error, assigned_roles, created_by, created_at, updated_at,
          deleted_at
        ) VALUES (
          ${proc.id as string},
          ${proc.namespace as string},
          ${proc.definitionName as string},
          ${String(proc.definitionVersion)},
          ${proc.status as string},
          ${(proc.currentStepId as string | null) ?? null},
          ${sql.json((proc.variables as unknown) ?? {})},
          ${proc.triggerType as string},
          ${proc.triggerPayload ? sql.json(proc.triggerPayload as unknown) : null},
          ${(proc.pauseReason as string | null) ?? null},
          ${(proc.error as string | null) ?? null},
          ${(proc.assignedRoles as string[] | undefined) ?? null},
          ${(proc.createdBy as string | null) ?? null},
          ${proc.createdAt as string},
          ${proc.updatedAt as string},
          ${(proc.deletedAt as string | null) ?? null}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── 5. step_executions ──────────────────────────────────────────────────
    const allStepExecutions: Record<string, Record<string, unknown>> = {
      ...data.stepExecutions,
      ...data.humanWaitingStepExecutions,
      ...data.reviewTargetStepExecutions,
      ...data.completedProcessStepExecutions,
      ...data.completedSupplyChainStepExecutions,
      ...data.stepFailureStepExecutions,
      ...data.retryTestStepExecutions,
      ...data.agentEscalatedCancelStepExecutions,
      ...data.workflowRunStepExecutions,
    };
    for (const exec of Object.values(allStepExecutions)) {
      await sql`
        INSERT INTO step_executions (
          id, process_instance_id, step_id, status, iteration_number,
          input, output, verdict, gate_result, error, executed_by,
          started_at, completed_at
        ) VALUES (
          ${exec.id as string},
          ${exec.instanceId as string},
          ${exec.stepId as string},
          ${exec.status as string},
          ${(exec.iterationNumber as number | undefined) ?? 1},
          ${exec.input ? sql.json(exec.input as unknown) : null},
          ${exec.output ? sql.json(exec.output as unknown) : null},
          ${(exec.verdict as string | null) ?? null},
          ${exec.gateResult ? sql.json(exec.gateResult as unknown) : null},
          ${(exec.error as string | null) ?? null},
          ${(exec.executedBy as string | null) ?? null},
          ${(exec.startedAt as string | null) ?? null},
          ${(exec.completedAt as string | null) ?? null}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── 6. human_tasks ──────────────────────────────────────────────────────
    // Workspace derived from parent process instance (table has FK to
    // workspaces but column is set explicitly, mirroring repo behaviour).
    for (const task of Object.values(data.humanTasks)) {
      const parent = data.processInstances[task.processInstanceId as string];
      const workspace = (parent?.namespace as string | undefined) ?? TEST_ORG_HANDLE;
      await sql`
        INSERT INTO human_tasks (
          id, workspace, process_instance_id, step_id, assigned_role,
          assigned_user_id, status, deadline, completion_data, completed_at,
          ui, params, verdicts, creation_reason, created_at, updated_at
        ) VALUES (
          ${task.id as string},
          ${workspace},
          ${task.processInstanceId as string},
          ${task.stepId as string},
          ${task.assignedRole as string},
          ${(task.assignedUserId as string | null) ?? null},
          ${task.status as string},
          ${(task.deadline as string | null) ?? null},
          ${task.completionData ? sql.json(task.completionData as unknown) : null},
          ${(task.completedAt as string | null) ?? null},
          ${task.ui ? sql.json(task.ui as unknown) : null},
          ${task.params ? sql.json(task.params as unknown) : null},
          ${task.verdicts ? sql.json(task.verdicts as unknown) : null},
          ${(task.creationReason as string | undefined) ?? 'human_executor'},
          ${task.createdAt as string},
          ${task.updatedAt as string}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── 7. agent_runs ───────────────────────────────────────────────────────
    for (const run of Object.values(data.agentRuns)) {
      const parent = data.processInstances[run.processInstanceId as string];
      const workspace = (parent?.namespace as string | undefined) ?? TEST_ORG_HANDLE;
      const envelope = run.envelope as Record<string, unknown> | null;
      await sql`
        INSERT INTO agent_runs (
          id, workspace, process_instance_id, step_id, plugin_id, autonomy_level,
          status, fallback_reason, confidence, model, duration_ms,
          envelope_payload, executor_type, reviewer_type, started_at, completed_at
        ) VALUES (
          ${run.id as string},
          ${workspace},
          ${run.processInstanceId as string},
          ${run.stepId as string},
          ${run.pluginId as string},
          ${run.autonomyLevel as string},
          ${run.status as string},
          ${(run.fallbackReason as string | null) ?? null},
          ${envelope && typeof envelope.confidence === 'number' ? envelope.confidence : null},
          ${envelope && typeof envelope.model === 'string' ? envelope.model : null},
          ${envelope && typeof envelope.duration_ms === 'number' ? envelope.duration_ms : null},
          ${envelope ? sql.json(envelope as unknown) : null},
          ${(run.executorType as string | null) ?? null},
          ${(run.reviewerType as string | null) ?? null},
          ${run.startedAt as string},
          ${(run.completedAt as string | null) ?? null}
        )
      `;
    }

    // ── 8. audit_events ─────────────────────────────────────────────────────
    for (const ev of Object.values(data.auditEvents)) {
      const parent = data.processInstances[ev.processInstanceId as string];
      const workspace = (parent?.namespace as string | undefined) ?? TEST_ORG_HANDLE;
      const payload = {
        description: ev.description,
        basis: ev.basis,
        inputSnapshot: ev.inputSnapshot,
        outputSnapshot: ev.outputSnapshot,
      };
      await sql`
        INSERT INTO audit_events (
          workspace, actor_id, actor_type, actor_role, action,
          entity_type, entity_id, process_instance_id, step_id,
          process_definition_version, timestamp, payload
        ) VALUES (
          ${workspace},
          ${ev.actorId as string},
          ${ev.actorType as string},
          ${ev.actorRole as string},
          ${ev.action as string},
          ${ev.entityType as string},
          ${ev.entityId as string},
          ${(ev.processInstanceId as string | null) ?? null},
          ${(ev.stepId as string | null) ?? null},
          ${(ev.processDefinitionVersion as string | null) ?? null},
          ${ev.timestamp as string},
          ${sql.json(payload as unknown)}
        )
      `;
    }

    // ── 9. cowork_sessions + cowork_turns ───────────────────────────────────
    for (const session of Object.values(data.coworkSessions)) {
      const parent = data.processInstances[session.processInstanceId as string];
      const workspace = (parent?.namespace as string | undefined) ?? TEST_ORG_HANDLE;
      await sql`
        INSERT INTO cowork_sessions (
          id, workspace, process_instance_id, step_id, assigned_role,
          assigned_user_id, status, agent, model, system_prompt,
          output_schema, voice_config, artifact, finalized_at,
          created_at, updated_at
        ) VALUES (
          ${session.id as string},
          ${workspace},
          ${session.processInstanceId as string},
          ${session.stepId as string},
          ${session.assignedRole as string},
          ${(session.assignedUserId as string | null) ?? null},
          ${session.status as string},
          ${session.agent as string},
          ${(session.model as string | null) ?? null},
          ${(session.systemPrompt as string | null) ?? null},
          ${session.outputSchema ? sql.json(session.outputSchema as unknown) : null},
          ${session.voiceConfig ? sql.json(session.voiceConfig as unknown) : null},
          ${session.artifact ? sql.json(session.artifact as unknown) : null},
          ${(session.finalizedAt as string | null) ?? null},
          ${session.createdAt as string},
          ${session.updatedAt as string}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      const turns = (session.turns as Array<Record<string, unknown>> | undefined) ?? [];
      for (let i = 0; i < turns.length; i += 1) {
        const turn = turns[i];
        await sql`
          INSERT INTO cowork_turns (
            id, session_id, idx, role, content, artifact_delta, timestamp
          ) VALUES (
            ${turn.id as string},
            ${session.id as string},
            ${i},
            ${turn.role as string},
            ${turn.content as string},
            ${turn.artifactDelta ? sql.json(turn.artifactDelta as unknown) : null},
            ${turn.timestamp as string}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }

    // ── 10. agents ──────────────────────────────────────────────────────────
    for (const [id, agent] of Object.entries(data.agentDefinitions)) {
      await sql`
        INSERT INTO agents (
          id, workspace, kind, runtime_id, name, icon_name, description,
          foundation_model, system_prompt, input_description,
          output_description, skill_file_names, mcp_servers, namespace,
          visibility, created_at, updated_at
        ) VALUES (
          ${id},
          ${(agent.namespace as string | undefined) ?? null},
          ${(agent.kind as string | undefined) ?? 'plugin'},
          ${(agent.runtimeId as string | undefined) ?? null},
          ${agent.name as string},
          ${agent.iconName as string},
          ${agent.description as string},
          ${agent.foundationModel as string},
          ${(agent.systemPrompt as string | undefined) ?? ''},
          ${agent.inputDescription as string},
          ${agent.outputDescription as string},
          ${sql.json((agent.skillFileNames as unknown) ?? [])},
          ${agent.mcpServers ? sql.json(agent.mcpServers as unknown) : null},
          ${(agent.namespace as string | undefined) ?? null},
          ${(agent.visibility as string | undefined) ?? 'private'},
          ${(agent.createdAt as string | undefined) ?? new Date().toISOString()},
          ${(agent.updatedAt as string | undefined) ?? new Date().toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── 11. model_registry_entries ──────────────────────────────────────────
    for (const model of Object.values(data.modelRegistry)) {
      const pricing = model.pricing as Record<string, unknown> | undefined;
      await sql`
        INSERT INTO model_registry_entries (
          id, canonical_slug, name, provider, context_length,
          max_completion_tokens, pricing, modality, input_modalities,
          output_modalities, supports_tools, supports_vision, source,
          request_count, last_synced_at, created_at, updated_at
        ) VALUES (
          ${model.id as string},
          ${(model.canonicalSlug as string | null) ?? null},
          ${model.name as string},
          ${model.provider as string},
          ${model.contextLength as number},
          ${(model.maxCompletionTokens as number | null) ?? null},
          ${pricing ? sql.json(pricing as unknown) : sql.json({})},
          ${model.modality as string},
          ${sql.json((model.inputModalities as unknown) ?? [])},
          ${sql.json((model.outputModalities as unknown) ?? [])},
          ${model.supportsTools as boolean},
          ${model.supportsVision as boolean},
          ${model.source as string},
          ${(model.requestCount as number | null) ?? null},
          ${model.lastSyncedAt as string},
          ${model.createdAt as string},
          ${model.updatedAt as string}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── 12. tool_catalog_entries (scoped to TEST_ORG_HANDLE) ────────────────
    for (const [id, entry] of Object.entries(data.toolCatalog)) {
      await sql`
        INSERT INTO tool_catalog_entries (
          workspace, id, command, args, env, description
        ) VALUES (
          ${TEST_ORG_HANDLE},
          ${id},
          ${entry.command as string},
          ${entry.args ? sql.json(entry.args as unknown) : null},
          ${entry.env ? sql.json(entry.env as unknown) : null},
          ${(entry.description as string | undefined) ?? null}
        )
        ON CONFLICT (workspace, id) DO NOTHING
      `;
    }

    // ── 13. oauth_providers (scoped to TEST_ORG_HANDLE) ─────────────────────
    for (const [id, provider] of Object.entries(data.oauthProviders)) {
      await sql`
        INSERT INTO oauth_providers (
          workspace, id, name, client_id, client_secret,
          authorize_url, token_url, revoke_url, user_info_url,
          scopes, created_at, updated_at
        ) VALUES (
          ${TEST_ORG_HANDLE},
          ${id},
          ${provider.name as string},
          ${provider.clientId as string},
          ${(provider.clientSecret as string | null) ?? null},
          ${provider.authorizeUrl as string},
          ${provider.tokenUrl as string},
          ${(provider.revokeUrl as string | null) ?? null},
          ${(provider.userInfoUrl as string | null) ?? null},
          ${sql.json((provider.scopes as unknown) ?? [])},
          ${(provider.createdAt as string | undefined) ?? new Date().toISOString()},
          ${(provider.updatedAt as string | undefined) ?? new Date().toISOString()}
        )
        ON CONFLICT (workspace, id) DO NOTHING
      `;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Seed a `user_profiles` row (ADR-0001 final cutover, #534). Replaces the
 * former Firestore `users/{uid}.mustChangePassword` write — the only
 * application-owned profile field anything reads live. Used by the
 * forced-password-change journey to flag an invited user as pending a
 * permanent password before first sign-in.
 *
 * Idempotent: re-running the setup (Playwright retries) upserts the flag.
 */
export async function seedPostgresUserProfile(
  uid: string,
  mustChangePassword: boolean,
): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to seed Postgres for E2E.');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO user_profiles (uid, must_change_password)
      VALUES (${uid}, ${mustChangePassword})
      ON CONFLICT (uid) DO UPDATE SET
        must_change_password = EXCLUDED.must_change_password,
        updated_at = now()
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Seed a personal `workspaces` row + its owner `workspace_members` row.
 * Replaces the former Firestore `namespaces/{handle}` +
 * `namespaces/{handle}/members/{uid}` writes for journeys that pre-seed an
 * extra workspace (e.g. the invited user's personal namespace) so the
 * post-sign-in redirect resolves to a known handle instead of relying on the
 * lazy bootstrap in GET /api/users/me.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export async function seedPostgresPersonalNamespace(
  handle: string,
  uid: string,
  displayName: string,
): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to seed Postgres for E2E.');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO workspaces (handle, type, display_name, linked_user_id, created_at)
      VALUES (${handle}, 'personal', ${displayName}, ${uid}, now())
      ON CONFLICT (handle) DO NOTHING
    `;
    await sql`
      INSERT INTO workspace_members (workspace, uid, role, joined_at)
      VALUES (${handle}, ${uid}, 'owner', now())
      ON CONFLICT (workspace, uid) DO NOTHING
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Seed an organization `workspaces` row plus an owner `workspace_members` row.
 * Replaces the former Firestore `namespaces/{handle}` (type organization) +
 * `namespaces/{handle}/members/{uid}` writes — the legacy `users/{uid}`
 * doc's `organizations` array is not carried over (org membership now derives
 * solely from `workspace_members`, per the user-profile schema note).
 *
 * Pass `bio` to pre-populate the optional workspace bio (the bio-clear journey
 * needs a non-empty starting value to clear).
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export async function seedPostgresOrganizationNamespace(
  handle: string,
  ownerUid: string,
  displayName: string,
  options: { bio?: string } = {},
): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to seed Postgres for E2E.');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO workspaces (handle, type, display_name, bio, created_at)
      VALUES (${handle}, 'organization', ${displayName}, ${options.bio ?? null}, now())
      ON CONFLICT (handle) DO NOTHING
    `;
    await sql`
      INSERT INTO workspace_members (workspace, uid, role, joined_at)
      VALUES (${handle}, ${ownerUid}, 'owner', now())
      ON CONFLICT (workspace, uid) DO NOTHING
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Read the persisted `workspaces` row for a handle, or `null` if absent.
 * Returns the raw column values so a journey can assert field-level shape
 * (e.g. that a cleared bio is stored as an empty string, not NULL) — the
 * Postgres equivalent of the former `getDocumentFields('namespaces', handle)`.
 */
export async function readPostgresWorkspace(
  handle: string,
): Promise<{ handle: string; displayName: string; bio: string | null } | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to read Postgres for E2E.');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ handle: string; display_name: string; bio: string | null }[]>`
      SELECT handle, display_name, bio FROM workspaces WHERE handle = ${handle}
    `;
    const row = rows[0];
    if (!row) return null;
    return { handle: row.handle, displayName: row.display_name, bio: row.bio };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Delete a single `agent_oauth_tokens` row (workspace, agent_id, server_name).
 * Replaces the former Firestore `deleteDocument` of the per-agent OAuth token
 * doc. Missing rows are a no-op, so the OAuth journey can call it to stay
 * idempotent across Playwright retries.
 */
export async function deletePostgresAgentOAuthToken(
  workspace: string,
  agentId: string,
  serverName: string,
): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to delete from Postgres for E2E.');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      DELETE FROM agent_oauth_tokens
      WHERE workspace = ${workspace}
        AND agent_id = ${agentId}
        AND server_name = ${serverName}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
