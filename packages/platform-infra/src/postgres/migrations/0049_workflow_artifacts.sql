-- Files a workflow version carries with it: the scripts its steps run, the
-- Dockerfile its image is built from, the skills its agents read.
--
-- Today those files only exist in a git repository, so a workflow authored in
-- the app cannot have any: `skillsDir` resolves against a checkout on the host
-- and a lazy image build clones a repo at a SHA to get a build context. That
-- makes a checkout a hard requirement for anything past an inline script, which
-- is the escape hatch this column closes.
--
-- On the definition rather than in a table of its own, because the files ARE
-- part of the definition: they version with it, a rollback brings back the files
-- that version ran with, and copy/paste/export of a definition carries them
-- without a second mechanism. Text only and capped by
-- `WorkflowArtifactSchema` (64 KiB a file, 256 KiB the set), so a definition row
-- stays a definition row; bytes past that are a dependency, and belong in an
-- image or a repository.
--
-- Nullable with no backfill: every existing version carries no files and keeps
-- resolving exactly as it does today.
ALTER TABLE "workflow_definitions" ADD COLUMN "artifacts" jsonb;--> statement-breakpoint

COMMENT ON COLUMN "workflow_definitions"."artifacts" IS
  'Text files this version carries ([{path, contents}]): scripts, Dockerfile, skills. Materialized to a host directory and mounted read-only at /artifacts, so a run needs no git checkout. NULL = carries none.';
