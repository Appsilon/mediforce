# 0003 — Remove Firebase Storage: skills to Postgres, attachments inline or via external link

- **Status:** Proposed
- **Date:** 2026-05-20
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Depends on:** [ADR-0001](./0001-firestore-to-postgres.md) (Postgres is the target for skill blobs and attachments)
- **Implementation plan:** [PLAN-0003.md](./PLAN-0003.md)

## Context

Firebase Storage today holds two distinct things in Mediforce:

- **Skill files** attached to Agent Definitions — small (≤100KB cap), text /
  markdown / scripts, occasionally binary. Read by the agent runtime at spawn
  time. Used at the new-agent UI and at agent runtime via
  `packages/platform-ui/src/lib/resolve-agent-identity.ts`.
- **Task attachments** uploaded by humans inside a Human Task — `uploadBytesResumable`,
  no explicit size cap, used in `packages/platform-ui/src/components/tasks/task-detail.tsx`
  via the `FileUploadZone` component.

Firebase Storage is a managed Google service. It has the same on-prem block as
Firestore (ADR-0001) and Firebase Auth (ADR-0002).

A purpose-built object store (S3 / MinIO / Azure Blob) would replicate
capability that pharma customers already own: every serious pharma org has a
Document Management System (Veeva Vault, SharePoint Online, OpenText,
Documentum) where regulated files **must** live for 21 CFR Part 11
compliance — versioning, e-signature, retention, audit. Bundling another
object store with mediforce duplicates that capability and widens the on-prem
operational surface for no real benefit.

Domain terms — Workspace, Agent Definition, Human Task — are defined in
[`CONTEXT.md`](../../CONTEXT.md).

## Decision

Eliminate object storage from Mediforce entirely. No S3, no MinIO, no
replacement service.

1. **Skill files → Postgres `bytea`.** New child table
   `agent_definition_skills (agent_definition_id, name, content_type, content bytea, ...)`
   cascade-deleted with the parent Agent Definition. The 100KB per-file cap
   stays. Embedded with the Agent Definition; one query loads everything an
   agent needs at spawn time.

2. **Task attachments → dual mode, side by side in the UI.**
   - **Inline upload up to 10MB.** Stored as Postgres `bytea` in a dedicated
     table (`task_attachment_blobs`) keyed off `task_attachments.id` so the
     hot `task_attachments` metadata table stays lean.
   - **External link to a customer-controlled DMS** (paste URL of a file in
     Veeva / SharePoint / Documentum / OpenText). Mediforce stores the
     string + access audit. The DMS remains the source of truth and the
     compliance owner.
   - 10MB cap covers screenshots, short notes, sample exports, ad-hoc
     work product. Larger / regulated files go through the DMS link path.

3. **No new infrastructure service** is added to the Mediforce stack.
   It stays Next.js + Postgres + Redis + (per-step) container worker.
   Single `docker-compose up` keeps working; air-gapped pharma deploys
   need no extra configuration to start.

4. **Firebase Storage is removed end-to-end** during the storage cutover
   for ADR-0001. The same Python migration script that moves Firestore
   data to Postgres also reads every `agentSkills/…` and `tasks/…/…`
   object from Firebase Storage, ingests them into Postgres, and stops
   touching Firebase Storage thereafter.

## Considered alternatives

- **Self-hosted MinIO container.** Rejected — adds an extra service to the
  stack we'd have to operate, monitor, back up. Pharma deploys typically
  already have S3-compatible storage they'd prefer to point at, not a
  bundled second one.
- **Customer-provided S3-compatible bucket via env.** Considered — would
  work in production but breaks the goal of a single-container demo and
  air-gapped pharma footprint. Punt to a future ADR if a customer ever asks.
- **Postgres `bytea` for all attachments without size cap.** Rejected —
  large `bytea` rows bloat pg_dump, slow queries, hurt connection pooling.
  10MB cap is a deliberate UX choice that nudges large content to the DMS
  where it belongs.
- **Git LFS via `gitWorkspace` for skill files.** Clever but mismatched
  scope: skills are properties of an Agent Definition; `gitWorkspace` is a
  per-workflow git working tree. Conflating them complicates ownership.
- **External DMS only, no inline upload.** Rejected because it breaks the
  demo experience — every evaluator would need to configure a DMS first.
- **Drop task attachments as a feature.** Considered. Rejected — small
  inline attachments are useful for screenshots, notes, sample data, and
  cost nothing in the chosen design.

## Consequences

- Stack stays Postgres + Redis + Next.js + worker. Zero new SaaS or new
  container.
- Demo and local dev work out of the box; no Firebase project, no S3 bucket,
  no MinIO container.
- Pharma deploys do not need to configure storage to start. DMS integration
  is a paste-a-URL feature, not an infrastructure setup.
- `pg_dump` captures everything in one backup. PITR covers attachments too.
- Postgres database size grows with attachment content. Estimate: 10MB cap,
  ~thousands of attachments per workspace per year. Manageable. Future
  retention policy in a separate ADR if a customer hits capacity limits.
- The 10MB cap is a real product constraint. Users uploading clinical PDFs,
  raw datasets, or long video must use the DMS link path. UI must surface
  this clearly.
- We give up the ability to serve files via a CDN-backed bucket URL.
  Mediforce serves attachments via authenticated app routes. Slower for
  very large or very frequent reads — fine at our scale.

## Enterprise / pharma fit

- DMS stays the source of truth for regulated files — exactly what 21 CFR
  Part 11 expects: versioning, e-signature, retention, access audit all
  live where the customer's QA team already runs them.
- Mediforce orchestrates workflow around files; it does not try to be the
  DMS. Clear separation of concerns in vendor-risk reviews.
- Air-gapped pharma deploys (no internet egress, no SaaS) work end-to-end
  with this design.
- Inline 10MB covers ad-hoc / non-regulated work product (screenshots of
  bugs, brief notes, mock data) without forcing every user through the
  DMS for trivial attachments.

## Out of scope

- **External DMS integration adapters** (Veeva Vault API, SharePoint
  Graph API, Documentum REST) — future feature, not infrastructure.
  Stored URLs work as opaque strings today; preview / metadata fetch can
  come later.
- **Encryption at rest beyond Postgres defaults** (TDE, customer-managed
  keys) — future ADR if a customer asks.
- **File scanning / antivirus** for inline uploads — future ADR.
- **CDN serving of attachments** — not needed at current scale.
- **Customer-provided S3 adapter** — future ADR if a deployment ever needs
  more than the 10MB inline + DMS-link combo.

## Open questions for review

- **10MB cap value** — confirm not 5 / 25 / 50. Trade-off: bigger inline
  cap helps demos and small deployments; smaller cap protects Postgres
  backups and connection pool. 10MB is the recommended starting point.
- **Whether skill files realistically need to stay binary-capable** — today's
  cap is 100KB and content is text/markdown/scripts in practice. Could
  tighten to `text` column if confirmed never binary; `bytea` is safer.
- **Whether attachments are stored on Tasks only, or also belong on
  Process Instances / Cowork Sessions** — today only Tasks. Confirm we're
  not pre-emptively adding the same on other entities.
