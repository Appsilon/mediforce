# 0003 — Remove Firebase Storage: delete uploaded-skills, task attachments to a BlobStore (filesystem now, S3 later)

- **Status:** Proposed (grilled & reshaped 2026-06-16; supersedes the
  2026-05-20 "skills → Postgres bytea / attachments inline + DMS link" draft)
- **Date:** 2026-05-20 (reshaped 2026-06-16)
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Depends on:** [ADR-0001](./0001-firestore-to-postgres.md) (Postgres for
  attachment metadata) and the shared-filesystem precedent in
  [ADR-0007](./0007-output-files-on-run-branch.md) (the `~/.mediforce` data
  volume the API host already mounts).
- **Lands before:** [ADR-0002](./0002-firebase-auth-to-nextauth.md) — see §5.
- **Implementation plan:** [PLAN-0003.md](./PLAN-0003.md)

## Context

Firebase Storage today holds two distinct things in Mediforce, both written
**client-direct from the browser** and authorized by the Firebase Auth session
(`storage.rules`: `allow write: if request.auth != null`):

- **Uploaded skill files** attached to Agent Definitions
  (`AgentDefinition.skillFileNames` → `agentSkills/…`). At runtime
  `resolve-agent-identity.ts` downloads them and concatenates their text into
  the agent's system prompt. **This feature is dead:** every real app in
  `apps/` loads skills via the git-native `skillsDir` mechanism (Claude-Code
  `SKILL.md` files in the per-run worktree, PR #213); `skillFileNames` is
  empty (`[]`) across all seeds, fixtures, and `.wd.json` files.
- **Task attachments** uploaded by a human inside a Human Task
  (`uploadBytesResumable` → `tasks/…`, in
  `components/tasks/file-upload-view.tsx`). These are real and large workflow
  files matter (datasets, PDFs) — the upload exists precisely to take big
  files.

Firebase Storage is a managed Google service with the same on-prem block as
Firestore (ADR-0001) and Firebase Auth (ADR-0002).

Domain terms — Workspace, Agent Definition, Human Task — are defined in
[`CONTEXT.md`](../../CONTEXT.md).

## Decision

Remove Firebase Storage. Two moves: **delete the dead uploaded-skills
feature**, and **move task attachments to a `BlobStore` abstraction** with a
filesystem implementation now.

1. **Delete the uploaded-skills feature entirely.** Drop
   `AgentDefinition.skillFileNames` (Zod field + `agents.skill_file_names`
   column), the skill-upload UI (`agents/new`, `agents/definitions/[id]`), and
   the `downloadSkillFiles` / `## Skills` prompt-injection in
   `resolve-agent-identity.ts`. The git-native **`skillsDir`** path is the
   single remaining skill mechanism (a selected repo provides skills); extra
   prompt text lives in the existing `systemPrompt` field. No data migration —
   the field is empty everywhere. _(Decision 2026-06-16: the feature is being
   reworked toward repo-selected skill loading; until then it is removed
   rather than migrated.)_

2. **Task attachments → `BlobStore` interface; filesystem impl now,
   S3-compatible later.** Bytes go through a `BlobStore` port
   (`put` / `get` / `getStream` / `delete` by key). The default implementation
   writes under the **`~/.mediforce` data volume the API host already mounts
   for ADR-0007** — no new service, no new operational requirement. An
   S3-compatible implementation is an env-selected drop-in for deployments
   that already run object storage (deferred until a deployment asks; the
   interface keeps it non-breaking). Attachment **metadata** (name,
   content-type, size, workspace, task, uploader, blob key) lives in a
   Postgres `task_attachments` table; **bytes never go into Postgres**.

3. **No object-storage service is mandatory.** Stack stays Next.js + Postgres
   + Redis + worker + the existing `~/.mediforce` volume. `docker-compose up`
   and air-gapped pharma deploys keep working with zero extra configuration.

4. **Configurable size guard, not a hard 10MB cap.** A
   `MEDIFORCE_ATTACHMENT_MAX_BYTES` env (default **100 MiB**, matching ADR-0007's
   `MEDIFORCE_OUTPUT_FILE_MAX_BYTES`) guards against disk exhaustion. It is an
   operational guard, not a design constraint pushing files elsewhere — the
   filesystem backend handles large files, which is the whole point of the
   upload.

5. **Sequencing — Storage lands before Auth (ADR-0002).** Today's uploads are
   client-direct and Firebase-Auth-authorized; removing Firebase Auth first
   would null `request.auth` and break every upload. This ADR moves uploads to
   server-mediated **headless routes** (ADR-0005 / AGENTS.md §8 — never Server
   Actions) → `BlobStore`, severing the Firebase-Auth dependency, so it lands
   first. Consequently `task_attachments.uploaded_by` is a Firebase-uid `text`
   column (no FK to ADR-0002's not-yet-existing `auth_users`); ADR-0002's
   staging remap rewrites it when fresh uuids land.

6. **Firebase Storage removed via a standalone one-time migration.** ADR-0001's
   Firestore → Postgres cutover already shipped (#534), so this is a separate
   storage-only script, run once against staging: copy each `tasks/…` object
   into the `BlobStore` and write its `task_attachments` row. `agentSkills/…`
   objects are simply abandoned (feature deleted). New deployments start clean.

**Dropped from the earlier draft:** the **DMS external-link** attachment mode.
It was net-new (zero code today) and existed only to avoid hosting large files;
with a real `BlobStore` it is unnecessary. A "reference a file already in the
customer's Veeva / SharePoint" feature can return later as its own product
decision, not a storage-infra necessity.

## Considered alternatives

- **Postgres `bytea` for attachment bytes** (the earlier draft). Rejected for
  large files: `bytea` loads fully into memory (no streaming from PG), bloats
  `pg_dump`, amplifies WAL, and holds a pooled connection for the whole
  transfer. Fine for a few MB, wrong for the large workflow files this upload
  exists to handle.
- **Mandatory self-hosted MinIO / S3 container.** Rejected as the *default* —
  an extra service to operate, monitor, back up, for a single-container demo
  and air-gapped footprint. Kept available as the **optional** `BlobStore`
  backend for deployments that want it.
- **DMS external-link as the path for large files.** Rejected — breaks the
  upload UX (every large file would require a pre-configured DMS); reintroduced
  later only as an optional reference feature if a customer asks.
- **Keep uploaded skills, migrate them to Postgres.** Rejected — the feature is
  dead (all apps use `skillsDir`); migrating dead weight violates "do it
  greenfield, simplest thing that's correct."
- **Pluggable `BlobStore` deferred (just hardcode filesystem).** Partially
  taken: we ship a **thin `BlobStore` port with only the filesystem
  implementation** now (the in-memory test double is required anyway by the
  repository-pattern test layer, so the port costs ~nothing). The S3 backend
  is **not built** — it stays a non-breaking future add, not a hypothetical we
  solve for the MVP. Speed over future-proofing (decision 2026-06-16).

## Consequences

- Stack stays Postgres + Redis + Next.js + worker + the existing `~/.mediforce`
  volume. Zero new mandatory SaaS or container.
- Large workflow files are supported (filesystem streaming), removing the
  earlier draft's 10MB ceiling.
- Object storage is a non-breaking opt-in (`BlobStore` S3 impl) when a
  deployment wants it.
- `pg_dump` stays lean — only metadata in Postgres; bytes live on the volume
  (backed up by volume snapshot, same as ADR-0007's bare repos).
- Attachments are served via authenticated, workspace-scoped streaming app
  routes — no public bucket URLs, no CDN (fine at our scale).
- The Agent Definition surface shrinks (`skillFileNames` gone); the only skill
  path is `skillsDir` from a selected repo.
- The API host must share the `~/.mediforce` filesystem — already an ADR-0007
  assumption, not new.

## Enterprise / pharma fit

- Air-gapped pharma deploys (no egress, no SaaS) work end-to-end: files on the
  local volume, no Google bucket.
- A deployment that standardizes on its own S3-compatible storage points the
  `BlobStore` at it via env — no Mediforce-bundled object store to vendor-review.
- `pg_dump` + volume snapshot is the whole backup story; PITR covers metadata.
- Regulated-file handling (Veeva as system of record) returns later as an
  optional reference-link feature if a customer's QA process requires it.

## Out of scope

- **S3-compatible `BlobStore` implementation** — interface ships now, S3 impl
  when a deployment asks. Non-breaking addition.
- **External DMS reference-link attachments** (Veeva / SharePoint URL) —
  future product feature, not storage infra.
- **Antivirus / content scanning** of uploads — future ADR.
- **Encryption at rest beyond volume/Postgres defaults** — future ADR.
- **CDN serving of attachments** — not needed at current scale.

## Open questions for review

- **Default `MEDIFORCE_ATTACHMENT_MAX_BYTES`** — 100 MiB proposed (parity with
  ADR-0007's output-file cap). Confirm it is generous enough for the large
  workflow files the upload targets, or set higher.
- **`task_attachments.task_id` FK type** — match `human_tasks.id` (Firestore-
  shaped `text` per the ADR-0001 "stay text" precedent). Confirm at impl time.
- **Attachments scoped to Human Tasks only** — confirmed 2026-06-16: not added
  to Process Instances / Cowork Sessions pre-emptively.
