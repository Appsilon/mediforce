#!/usr/bin/env python3
"""Guarded, per-environment Firebase Auth -> NextAuth cutover seed (ADR-0002).

This is the *automated* path for the manual seed sequence in
``docs/adr/RUNBOOK-0002-staging-cutover.md`` (steps 4-5). It wraps the existing
seed ``scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts`` — it does
NOT re-implement seeding — behind a single command with every pre-flight guard
the runbook performs by eye, so the same cutover can be run against the next
environment (e.g. cdisc) without hand-copying commands.

What it automates (one command, per environment)
-------------------------------------------------
1. ``firebase auth:export`` (unless an export file is supplied).
2. All pre-flight sanity checks below, each of which ABORTS LOUDLY on mismatch.
3. The seed dry-run (authoritative counts) — always.
4. With ``--apply``: the seed ``--apply`` PLUS post-verification of the write.

Run it MANUALLY, AFTER the operator has set the target environment's Google
credentials + ``ALLOWED_EMAIL_DOMAINS`` (runbook step 2) and applied the auth
migrations 0030-0033 (runbook step 3). This script does neither of those — it
verifies the migrations landed (auth tables exist) and refuses otherwise.

Pre-flight guards (all abort with a non-zero exit + a clear message)
--------------------------------------------------------------------
* **Production protection.** Refuses outright if the ``--project`` id or
  ``--database-url`` looks like production (contains ``mediforce-platform`` /
  ``prod`` / ``production``) — no override exists for that. For any project id
  not on the known-staging allowlist it demands the explicit
  ``--allow-unlisted-env`` opt-in, so a new environment is always a conscious
  choice. Mirrors the seed's "never prod" header gate.
* **Auth tables exist.** Queries ``information_schema`` for ``auth_users``,
  ``user_roles``, ``auth_accounts`` and ``auth_sessions``; aborts with "run
  migrations first" if any is missing.
* **DB reachable.** A ``SELECT 1`` through the Postgres container; a clean error
  if it fails.
* **Domain assumption.** Parses the export, computes each user's email domain
  with the SAME logic as ``packages/platform-ui/src/lib/email-allowlist.ts``,
  and lists every user whose domain is NOT in ``--allowed-domains`` — they WILL
  be locked out after cutover (like Filip's gmail + ``test@crsnt.com`` on
  staging). Aborts unless ``--acknowledge-locked-out`` is passed, so it is never
  silent.
* **Password-only users.** Flags users with no federated Google provider in the
  export; their Firebase passwords are NOT migrated, so they cannot
  password-login afterwards. Printed as a warning (not fatal).
* **Empty / short export.** Aborts on 0 users; ``--min-users`` sets a higher
  floor (a short but valid file would otherwise silently seed too few users).

Dry-run (default) prints the counts, the locked-out list, the password-only
list, and a clear "DRY RUN — nothing written" line, driving the tsx seed's own
dry-run for the authoritative counts.

``--apply`` runs the tsx seed ``--apply`` and then post-verifies the write:
``auth_users`` row count >= the number seeded, zero rows with NULL
``email_verified``, and a uid-preservation spot-check (a sample of export
``localId`` values equal the DB ``auth_users.id`` for the same email). Any
failure aborts loudly.

How it talks to the environment (documented assumptions)
--------------------------------------------------------
* **The tsx seed** runs as a one-off ``node:22-bookworm`` container joined to
  the compose network (exactly the runbook's step-5 pattern): no host Node
  toolchain, no exposed DB port, DB reached via the ``postgres`` service DNS in
  ``--database-url``. Network name and repo path default to the staging layout
  (``mediforce_default`` derived from ``--repo-dir`` basename, ``/opt/mediforce``)
  and are overridable.
* **DB queries** (guards + post-verify) go through ``docker exec <container>
  psql`` against the Postgres *container* (default ``mediforce-postgres-1``,
  overridable). This was chosen over a direct ``psycopg`` connection because it
  needs the *fewest* host assumptions: ``--database-url`` points at the
  in-network ``postgres:5432`` DNS name, which is not resolvable from the host,
  and it requires no Python DB driver to be installed. The only host
  requirement is the Docker CLI, which the compose deployment already needs.

Never targets production. Idempotent (the seed upserts ``email_verified`` and
``ON CONFLICT DO NOTHING`` on ``user_roles``), so a re-run is safe.

Examples
--------
Dry-run against cdisc (operator has set that env's Google creds + allowlist and
run the migrations first)::

    python3 scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py \\
        --project mediforce-cdisc \\
        --database-url postgresql://mediforce:PW@postgres:5432/mediforce \\
        --allowed-domains cdisc.org \\
        --allow-unlisted-env

Apply, acknowledging that any non-cdisc.org accounts will be locked out::

    python3 scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py \\
        --project mediforce-cdisc \\
        --database-url postgresql://mediforce:PW@postgres:5432/mediforce \\
        --allowed-domains cdisc.org \\
        --allow-unlisted-env --acknowledge-locked-out --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

SEED_SCRIPT_REPO_PATH = "scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts"

# Hard production markers. If any appears in the project id or DATABASE_URL the
# script refuses with NO override — mirrors the seed header's "never prod" gate.
PRODUCTION_MARKERS = ("mediforce-platform", "production", "prod")

# Firebase project ids known to be non-production. Anything not listed here
# demands the explicit --allow-unlisted-env opt-in (a new env is a conscious
# choice, never a default). Add a new environment's project id as it is cut over.
KNOWN_STAGING_PROJECTS = frozenset({"mediforce-1c761", "mediforce-cdisc"})

SEED_CONTAINER_IMAGE = "node:22-bookworm"
DEFAULT_REPO_DIR = "/opt/mediforce"
DEFAULT_POSTGRES_CONTAINER = "mediforce-postgres-1"


class CutoverError(Exception):
    """A guard failed or a subprocess errored. Printed, then exit(1)."""


# --------------------------------------------------------------------------- #
# Output helpers
# --------------------------------------------------------------------------- #

def _line() -> str:
    return "-" * 68


def section(title: str) -> None:
    print(f"\n{_line()}\n  {title}\n{_line()}")


def info(message: str) -> None:
    print(f"  {message}")


def warn(message: str) -> None:
    print(f"  WARNING: {message}")


# --------------------------------------------------------------------------- #
# Email-domain allowlist — same semantics as
# packages/platform-ui/src/lib/email-allowlist.ts (parseAllowedDomains /
# isEmailDomainAllowed). Kept in lock-step so this pre-flight predicts exactly
# what the NextAuth signIn callback will do post-cutover.
# --------------------------------------------------------------------------- #

def parse_allowed_domains(csv: str | None) -> list[str]:
    return [d.strip().lower() for d in (csv or "").split(",") if d.strip() != ""]


def email_domain(email: str | None) -> str:
    if not email or "@" not in email:
        return ""
    return email.split("@")[1].lower()


def is_email_domain_allowed(email: str | None, allowed: list[str]) -> bool:
    if not allowed:
        return True
    domain = email_domain(email)
    return domain != "" and domain in allowed


# --------------------------------------------------------------------------- #
# Subprocess helpers
# --------------------------------------------------------------------------- #

def run(argv: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    """Run a command, echoing it. Raises CutoverError on non-zero exit."""
    info(f"$ {' '.join(argv)}")
    result = subprocess.run(
        argv,
        text=True,
        capture_output=capture,
        check=False,
    )
    if result.returncode != 0:
        detail = ""
        if capture:
            detail = f"\n{(result.stderr or result.stdout or '').strip()}"
        raise CutoverError(
            f"Command failed (exit {result.returncode}): {' '.join(argv)}{detail}",
        )
    return result


def require_binary(name: str, hint: str) -> None:
    if shutil.which(name) is None:
        raise CutoverError(f"`{name}` is not on PATH. {hint}")


# --------------------------------------------------------------------------- #
# DATABASE_URL parsing (for docker exec psql credentials)
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class DbCredentials:
    user: str
    password: str
    database: str
    host: str


def parse_database_url(database_url: str) -> DbCredentials:
    parts = urlsplit(database_url)
    if parts.scheme not in ("postgres", "postgresql"):
        raise CutoverError(
            f"--database-url must be a postgres:// URL, got scheme {parts.scheme!r}.",
        )
    database = parts.path.lstrip("/")
    if parts.username is None or database == "":
        raise CutoverError(
            "--database-url must include a user and a database name "
            "(postgresql://user:pass@host:5432/dbname).",
        )
    return DbCredentials(
        user=unquote(parts.username),
        password=unquote(parts.password) if parts.password else "",
        database=database,
        host=parts.hostname or "",
    )


# --------------------------------------------------------------------------- #
# psql-via-docker-exec (see module docstring for why this over psycopg)
# --------------------------------------------------------------------------- #

def psql_query(container: str, creds: DbCredentials, sql: str) -> list[str]:
    """Run a single query in the Postgres container, tuples-only. Rows as lines."""
    argv = [
        "docker", "exec",
        "-e", f"PGPASSWORD={creds.password}",
        container,
        "psql", "-U", creds.user, "-d", creds.database,
        "-tAqc", sql,
    ]
    # Do not echo PGPASSWORD.
    printable = [a if not a.startswith("PGPASSWORD=") else "PGPASSWORD=***" for a in argv]
    info(f"$ {' '.join(printable)}")
    result = subprocess.run(argv, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise CutoverError(
            "psql query failed against container "
            f"{container!r} (db {creds.database!r}, user {creds.user!r}):\n"
            f"{(result.stderr or result.stdout).strip()}",
        )
    return [row for row in result.stdout.strip().splitlines() if row != ""]


# --------------------------------------------------------------------------- #
# Firebase export parsing (for the domain + password-only + short-file guards).
# The tsx seed does the authoritative Zod validation and counts; here we only
# read what the guards need.
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ExportedUser:
    local_id: str
    email: str | None
    has_google_provider: bool


def read_export(path: Path) -> list[ExportedUser]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CutoverError(f"Export file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CutoverError(f"Export file {path} is not valid JSON: {exc}") from exc

    users = raw.get("users") if isinstance(raw, dict) else None
    if not isinstance(users, list):
        raise CutoverError(
            f"Export file {path} does not have the expected "
            '`firebase auth:export` shape ({"users": [...]}).',
        )

    parsed: list[ExportedUser] = []
    for entry in users:
        if not isinstance(entry, dict):
            continue
        provider_infos = entry.get("providerUserInfo") or []
        has_google = any(
            isinstance(p, dict) and p.get("providerId") == "google.com"
            for p in provider_infos
        )
        email = entry.get("email")
        parsed.append(
            ExportedUser(
                local_id=str(entry.get("localId", "")),
                email=email.lower() if isinstance(email, str) else None,
                has_google_provider=has_google,
            )
        )
    return parsed


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #

def guard_not_production(project: str, database_url: str, allow_unlisted: bool) -> None:
    section("Guard 1/6 — production protection")
    haystack = f"{project.lower()} {database_url.lower()}"
    hit = next((m for m in PRODUCTION_MARKERS if m in haystack), None)
    if hit is not None:
        raise CutoverError(
            f"Refusing to run: {hit!r} appears in the project id or DATABASE_URL. "
            "This looks like PRODUCTION. There is no override — never cut over prod "
            "with this tool.",
        )
    if project not in KNOWN_STAGING_PROJECTS and not allow_unlisted:
        raise CutoverError(
            f"Project {project!r} is not on the known-staging allowlist "
            f"({', '.join(sorted(KNOWN_STAGING_PROJECTS))}). If this is a new "
            "non-production environment, re-run with --allow-unlisted-env to confirm.",
        )
    info(f"OK — project {project!r} accepted "
         f"({'known staging' if project in KNOWN_STAGING_PROJECTS else 'unlisted, opt-in given'}).")


def guard_db_reachable(container: str, creds: DbCredentials) -> None:
    section("Guard 2/6 — target database reachable")
    require_binary(
        "docker",
        "The Docker CLI is required to reach the in-network Postgres via "
        "`docker exec` (see module docstring).",
    )
    rows = psql_query(container, creds, "SELECT 1;")
    if rows != ["1"]:
        raise CutoverError(
            f"Unexpected `SELECT 1` result from {container!r}: {rows!r}.",
        )
    info(f"OK — reachable via container {container!r}, database {creds.database!r}.")


def guard_auth_tables_exist(container: str, creds: DbCredentials) -> None:
    section("Guard 3/6 — auth tables exist (migrations 0030-0033)")
    required = ("auth_users", "user_roles", "auth_accounts", "auth_sessions")
    in_list = ", ".join(f"'{t}'" for t in required)
    rows = psql_query(
        container,
        creds,
        "SELECT table_name FROM information_schema.tables "
        f"WHERE table_schema = 'public' AND table_name IN ({in_list});",
    )
    present = set(rows)
    missing = [t for t in required if t not in present]
    if missing:
        raise CutoverError(
            f"Missing auth table(s): {', '.join(missing)}. "
            "Run the auth migrations (0030-0033) first — see RUNBOOK-0002 step 3.",
        )
    info(f"OK — all present: {', '.join(required)}.")


def guard_export_size(users: list[ExportedUser], min_users: int) -> None:
    section("Guard 4/6 — export sanity")
    if len(users) == 0:
        raise CutoverError(
            "Export contains 0 users. Refusing to seed an empty auth_users. "
            "Re-check the --project and re-export.",
        )
    if len(users) < min_users:
        raise CutoverError(
            f"Export contains {len(users)} user(s), below the --min-users floor "
            f"of {min_users}. A short export would silently seed too few users. "
            "Raise the export, or lower --min-users if this really is expected.",
        )
    info(f"OK — {len(users)} user(s) in export (floor {min_users}).")


def guard_locked_out(
    users: list[ExportedUser],
    allowed: list[str],
    acknowledged: bool,
) -> None:
    section("Guard 5/6 — domain allowlist (who gets locked out)")
    info(f"Allowed domains: {', '.join(allowed) if allowed else '(none — all allowed)'}")
    locked_out = [
        u for u in users
        if u.email is not None and not is_email_domain_allowed(u.email, allowed)
    ]
    no_email = [u for u in users if u.email is None]
    for u in no_email:
        warn(f"user {u.local_id} has no email — will be skipped by the seed.")
    if not locked_out:
        info("OK — every user with an email is inside the allowlist.")
        return
    warn(f"{len(locked_out)} user(s) will be LOCKED OUT after cutover "
         "(their email domain is not on the allowlist):")
    for u in locked_out:
        info(f"  - {u.email}  (uid {u.local_id})")
    if not acknowledged:
        raise CutoverError(
            "Locked-out users exist and --acknowledge-locked-out was not passed. "
            "Confirm this is intended (as on staging: Filip's gmail + test@crsnt.com), "
            "then re-run with --acknowledge-locked-out.",
        )
    info("Acknowledged via --acknowledge-locked-out.")


def guard_password_only(users: list[ExportedUser]) -> None:
    section("Guard 6/6 — password-only users (passwords NOT migrated)")
    password_only = [u for u in users if not u.has_google_provider]
    if not password_only:
        info("OK — every user has a Google provider; none rely on a password.")
        return
    warn(f"{len(password_only)} user(s) have NO Google provider in the export. "
         "Firebase passwords are not migrated, so they cannot password-login "
         "afterwards (they must use Google SSO or a future password reset):")
    for u in password_only:
        info(f"  - {u.email or '(no email)'}  (uid {u.local_id})")
    info("This is a WARNING, not fatal — surfaced so it is never a surprise.")


# --------------------------------------------------------------------------- #
# tsx seed invocation (one-off node container on the compose network)
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class SeedCounts:
    users_read: int
    auth_users: int
    user_roles: int
    skipped_no_email: int


def run_seed(
    *,
    repo_dir: str,
    network: str,
    database_url: str,
    export_file: Path,
    apply: bool,
) -> str:
    """Invoke the tsx seed inside a node container joined to the compose network.

    The export file's directory is mounted read-only at /cutover-export so the
    file need not live inside the repo tree.
    """
    require_binary("docker", "The Docker CLI is required to run the tsx seed container.")
    export_dir = str(export_file.resolve().parent)
    export_basename = export_file.name
    seed_argv = f"npx tsx {SEED_SCRIPT_REPO_PATH} /cutover-export/{export_basename}"
    if apply:
        seed_argv += " --apply"
    inner = (
        "corepack enable && "
        "pnpm install --frozen-lockfile --prefer-offline --silent && "
        f"{seed_argv}"
    )
    argv = [
        "docker", "run", "--rm",
        "--network", network,
        "-v", f"{repo_dir}:/repo",
        "-v", f"{export_dir}:/cutover-export:ro",
        "-w", "/repo",
        "-e", f"DATABASE_URL={database_url}",
        SEED_CONTAINER_IMAGE,
        "sh", "-c", inner,
    ]
    printable = [
        a if not a.startswith("DATABASE_URL=") else "DATABASE_URL=***" for a in argv
    ]
    info(f"$ {' '.join(printable)}")
    result = subprocess.run(argv, text=True, capture_output=True, check=False)
    sys.stdout.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise CutoverError(
            f"tsx seed {'--apply' if apply else 'dry-run'} failed "
            f"(exit {result.returncode}). See output above.",
        )
    return result.stdout


def parse_seed_counts(stdout: str) -> SeedCounts:
    def grab(label: str) -> int:
        match = re.search(rf"{re.escape(label)}\s*:\s*(\d+)", stdout)
        if match is None:
            raise CutoverError(
                f"Could not parse '{label}' from the seed output. "
                "The seed's output format may have changed.",
            )
        return int(match.group(1))

    return SeedCounts(
        users_read=grab("Firebase users read"),
        auth_users=grab("auth_users rows to seed"),
        user_roles=grab("user_roles rows to seed"),
        skipped_no_email=grab("skipped (no email)"),
    )


# --------------------------------------------------------------------------- #
# Post-apply verification
# --------------------------------------------------------------------------- #

def post_verify(
    container: str,
    creds: DbCredentials,
    users: list[ExportedUser],
    expected_auth_users: int,
) -> None:
    section("Post-apply verification")

    count_rows = psql_query(container, creds, "SELECT count(*) FROM auth_users;")
    actual = int(count_rows[0]) if count_rows else 0
    if actual < expected_auth_users:
        raise CutoverError(
            f"auth_users count {actual} is below the {expected_auth_users} rows the "
            "seed reported. The write did not fully land.",
        )
    info(f"OK — auth_users count {actual} >= {expected_auth_users} seeded.")

    null_rows = psql_query(
        container, creds,
        "SELECT count(*) FROM auth_users WHERE email_verified IS NULL;",
    )
    null_count = int(null_rows[0]) if null_rows else 0
    if null_count != 0:
        raise CutoverError(
            f"{null_count} auth_users row(s) have NULL email_verified. Verified email "
            "is what links the first Google sign-in onto the kept uid (ADR-0002 §4b); "
            "these users would be orphaned. Investigate before deploying NextAuth.",
        )
    info("OK — 0 rows with NULL email_verified.")

    sample = [u for u in users if u.email is not None][:5]
    if not sample:
        warn("No users with an email to spot-check uid preservation.")
        return
    mismatches: list[str] = []
    for u in sample:
        escaped = u.email.replace("'", "''")
        rows = psql_query(
            container, creds,
            f"SELECT id FROM auth_users WHERE email = '{escaped}';",
        )
        if rows != [u.local_id]:
            mismatches.append(f"{u.email}: export uid {u.local_id!r} != db {rows!r}")
    if mismatches:
        raise CutoverError(
            "uid preservation FAILED — the DB id does not match the Firebase localId "
            "for:\n  " + "\n  ".join(mismatches)
            + "\nThe first Google sign-in would mint a fresh uuid and orphan the user "
            "(RUNBOOK-0002 step 7 gate). Do NOT deploy NextAuth.",
        )
    info(f"OK — uid preserved for {len(sample)} sampled user(s) "
         "(export localId == auth_users.id).")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="migrate-to-nextauth.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Guarded Firebase Auth -> NextAuth cutover seed (ADR-0002). Wraps the "
            "tsx seed-user-roles script with all pre-flight guards from "
            "RUNBOOK-0002. Dry-run by default; --apply writes and post-verifies. "
            "Never targets production."
        ),
        epilog=(
            "cdisc example (dry-run):\n"
            "  python3 scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py \\\n"
            "    --project mediforce-cdisc \\\n"
            "    --database-url postgresql://mediforce:PW@postgres:5432/mediforce \\\n"
            "    --allowed-domains cdisc.org --allow-unlisted-env\n\n"
            "Add --acknowledge-locked-out --apply to write."
        ),
    )
    parser.add_argument(
        "--project", required=True,
        help="Firebase project id to export users from (firebase auth:export --project).",
    )
    parser.add_argument(
        "--database-url", required=True,
        help="Target Postgres URL as seen from inside the compose network "
             "(e.g. postgresql://mediforce:PW@postgres:5432/mediforce).",
    )
    parser.add_argument(
        "--allowed-domains", required=True,
        help="Comma-separated email domains expected on the target env's "
             "ALLOWED_EMAIL_DOMAINS (e.g. cdisc.org). Used to compute who gets "
             "locked out after cutover.",
    )
    parser.add_argument(
        "--export-file", type=Path, default=None,
        help="Path to an existing `firebase auth:export` JSON file. If omitted, the "
             "script runs the export itself into a temp file.",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually seed (default is a dry-run that writes nothing). Requires the "
             "guards to pass; post-verifies the write.",
    )
    parser.add_argument(
        "--allow-unlisted-env", action="store_true",
        help="Confirm a project id not on the known-staging allowlist (required for a "
             "new non-production environment such as cdisc).",
    )
    parser.add_argument(
        "--acknowledge-locked-out", action="store_true",
        help="Acknowledge that users whose email domain is outside --allowed-domains "
             "will be locked out. Required whenever such users exist.",
    )
    parser.add_argument(
        "--min-users", type=int, default=1,
        help="Abort if the export has fewer than this many users (short-file guard). "
             "Default: 1.",
    )
    parser.add_argument(
        "--repo-dir", default=DEFAULT_REPO_DIR,
        help=f"Repo checkout on the host, mounted into the seed container at /repo. "
             f"Default: {DEFAULT_REPO_DIR}.",
    )
    parser.add_argument(
        "--network", default=None,
        help="Docker compose network for the seed container. Default: derived from "
             "--repo-dir basename as '<basename>_default' (e.g. mediforce_default).",
    )
    parser.add_argument(
        "--postgres-container", default=DEFAULT_POSTGRES_CONTAINER,
        help=f"Postgres container name for docker-exec psql queries. "
             f"Default: {DEFAULT_POSTGRES_CONTAINER}.",
    )
    return parser


def resolve_export(args: argparse.Namespace, tmpdir: str) -> Path:
    if args.export_file is not None:
        return args.export_file
    require_binary(
        "firebase",
        "Install the Firebase CLI and `firebase login`, or pass --export-file.",
    )
    out = Path(tmpdir) / "users.json"
    section("Export Firebase users")
    run(["firebase", "auth:export", str(out), "--project", args.project])
    return out


def main() -> int:
    args = build_parser().parse_args()
    network = args.network or f"{Path(args.repo_dir).name}_default"

    try:
        creds = parse_database_url(args.database_url)
        allowed = parse_allowed_domains(args.allowed_domains)

        # Guard 1 runs before touching anything (including the export).
        guard_not_production(args.project, args.database_url, args.allow_unlisted_env)

        with tempfile.TemporaryDirectory(prefix="cutover-") as tmpdir:
            export_file = resolve_export(args, tmpdir)
            users = read_export(export_file)

            guard_db_reachable(args.postgres_container, creds)
            guard_auth_tables_exist(args.postgres_container, creds)
            guard_export_size(users, args.min_users)
            guard_locked_out(users, allowed, args.acknowledge_locked_out)
            guard_password_only(users)

            section("Seed dry-run (authoritative counts)")
            dry_stdout = run_seed(
                repo_dir=args.repo_dir,
                network=network,
                database_url=args.database_url,
                export_file=export_file,
                apply=False,
            )
            counts = parse_seed_counts(dry_stdout)

            if not args.apply:
                section("DRY RUN — nothing written")
                info(f"Firebase users read:     {counts.users_read}")
                info(f"auth_users to seed:      {counts.auth_users}")
                info(f"user_roles to seed:      {counts.user_roles}")
                info(f"skipped (no email):      {counts.skipped_no_email}")
                info("Re-run with --apply (plus --acknowledge-locked-out if needed) "
                     "to seed.")
                return 0

            section("APPLY — seeding auth_users + user_roles")
            run_seed(
                repo_dir=args.repo_dir,
                network=network,
                database_url=args.database_url,
                export_file=export_file,
                apply=True,
            )
            post_verify(args.postgres_container, creds, users, counts.auth_users)

            section("DONE — seed applied and verified")
            info("Next: RUNBOOK-0002 step 6 (deploy the NextAuth build) then the "
                 "step 7 go/no-go gate.")
            return 0

    except CutoverError as err:
        print(f"\nABORT: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nABORT: interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
