-- Composite index for `PostgresAuditRepository.getByActor`
-- (`WHERE actor_id = ? ORDER BY timestamp DESC LIMIT n`). Without it the
-- append-only `audit_events` table degrades to a full scan + sort as audit
-- volume grows. Mirrors the existing entity/process indexes' shape.
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","timestamp" DESC NULLS LAST);
