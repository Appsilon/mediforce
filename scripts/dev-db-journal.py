#!/usr/bin/env python3
"""Realign the local dev database's migration bookkeeping with `_journal.json`.

`pnpm dev` calls this between `dev-infra.py` and `pnpm db:migrate`.

drizzle-kit decides what is unapplied by comparing each journal entry's `when`
timestamp against the newest `created_at` in `drizzle.__drizzle_migrations` — it
does not look at the hash it stored. So a migration whose `when` changes AFTER
it ran locally looks brand new, and drizzle replays it into a schema that
already has it. That is not hypothetical: `docker-compose.dev.yml` deliberately
shares ONE Postgres volume across every worktree, so a branch that ran
`0050_x.sql` gets its `when` restamped on rebase (or by a colleague's
`db:generate` landing first) while the shared database still records the old
value. `pnpm dev` then dies on `CREATE TABLE ... already exists`, which
drizzle-kit reports as the famously actionable `applying migrations...undefined`.

The stored hash is the migration's real identity — sha256 of the .sql file, the
same bytes drizzle hashed when it applied it. Matching on that, a row whose SQL
is byte-identical to a journal entry IS that entry, whatever timestamp it
carries, so correcting `created_at` to the journal's `when` restores the order
drizzle expects without replaying or editing a single migration (migrations stay
immutable — see packages/platform-infra/README.md).

Scope is the local dev container by design: every query runs through
`docker compose exec postgres`, using the dev overlay's project name, so this
can never reach a staging or production database no matter what DATABASE_URL
says.

Usage:
    python3 scripts/dev-db-journal.py
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILES = ["-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"]
MIGRATIONS_DIR = REPO_ROOT / "packages/platform-infra/src/postgres/migrations"
JOURNAL = MIGRATIONS_DIR / "meta/_journal.json"
POSTGRES_SERVICE = "postgres"
POSTGRES_USER = "mediforce"
POSTGRES_DB = "mediforce"
MIGRATIONS_TABLE = "drizzle.__drizzle_migrations"


def psql(sql: str) -> str | None:
    """Run one statement in the dev Postgres container. None if unreachable."""
    result = subprocess.run(
        ["docker", "compose"]
        + COMPOSE_FILES
        + ["exec", "-T", POSTGRES_SERVICE, "psql"]
        + ["-U", POSTGRES_USER, "-d", POSTGRES_DB, "-t", "-A", "-F", "\t", "-c", sql],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def journal_when_by_hash() -> dict[str, int]:
    """sha256 of each migration's SQL → the `when` the journal now claims for it.

    A hash shared by two entries (byte-identical SQL) is dropped rather than
    guessed at: nothing can tell which row in the database is which.
    """
    entries = json.loads(JOURNAL.read_text())["entries"]
    when_by_hash: dict[str, int] = {}
    ambiguous: set[str] = set()
    for entry in entries:
        sql_file = MIGRATIONS_DIR / f"{entry['tag']}.sql"
        if sql_file.exists() is False:
            continue
        digest = hashlib.sha256(sql_file.read_bytes()).hexdigest()
        if digest in when_by_hash:
            ambiguous.add(digest)
        when_by_hash[digest] = entry["when"]
    for digest in ambiguous:
        del when_by_hash[digest]
    return when_by_hash


def applied_created_at_by_hash() -> dict[str, int] | None:
    """hash → created_at for every applied migration. None on a fresh database."""
    output = psql(
        "select to_regclass('" + MIGRATIONS_TABLE + "') is not null"
    )
    if output is None or output.strip() != "t":
        return None
    rows = psql(f"select hash, created_at from {MIGRATIONS_TABLE};")
    if rows is None:
        return None
    created_at_by_hash: dict[str, int] = {}
    for line in rows.splitlines():
        if line.strip() == "":
            continue
        digest, created_at = line.split("\t")
        created_at_by_hash[digest] = int(created_at)
    return created_at_by_hash


def main() -> None:
    applied = applied_created_at_by_hash()
    if applied is None:
        # Fresh database, or Docker not up — `db:migrate` owns both outcomes.
        return

    journal = journal_when_by_hash()
    drifted = [
        (digest, expected)
        for digest, expected in journal.items()
        if digest in applied and applied[digest] != expected
    ]
    if len(drifted) == 0:
        return

    for digest, expected in drifted:
        updated = psql(
            f"update {MIGRATIONS_TABLE} set created_at = {expected} "
            f"where hash = '{digest}';"
        )
        if updated is None:
            print(
                f"\033[31m✗ pnpm dev: could not realign migration {digest[:12]} "
                f"in the dev database.\033[0m",
                file=sys.stderr,
            )
            sys.exit(1)

    print(
        f"\033[32m✓ Realigned {len(drifted)} already-applied "
        f"migration{'' if len(drifted) == 1 else 's'} with _journal.json\033[0m"
    )


if __name__ == "__main__":
    main()
