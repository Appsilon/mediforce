#!/usr/bin/env python3
"""Consistent Postgres + Output Files snapshot for the `backup` service.

`create` runs as borgmatic's pre-create hook and writes into STAGING, which the
archive then holds. Postgres is dumped first, then each bare repo is bundled:
the database only records a commit after it exists, so every commit the dump
names is in a bundle. A bundle reads the refs and then packs what they reach,
so unlike borg walking a live repo it never holds a ref without its objects.

`restore ROOT` runs in a one-off container after the archive is extracted under
ROOT (the host's /var/lib/mediforce): it rebuilds each repo's objects and refs
from its bundle, loads the dump, and removes the staging copy.

Runbook: docs/guides/backup-and-restore.md.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

DATA_DIR = Path('/var/lib/mediforce')
STAGING_NAME = 'backup-staging'
DUMP_NAME = 'postgres.dump'
BUNDLES_NAME = 'git-bundles'
# Must match the postgres image's major version and EXTRA_PKGS; see the runbook.
PG_BIN = Path('/usr/libexec/postgresql16')


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ['git', '-c', 'safe.directory=*', '-C', str(repo), *args],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    return result.stdout


def postgres_args() -> list[str]:
    return [
        '--host=postgres',
        f"--username={os.environ['POSTGRES_USER']}",
        f"--dbname={os.environ['POSTGRES_DB']}",
        '--no-password',
    ]


def postgres_env() -> dict[str, str]:
    return {**os.environ, 'PGPASSWORD': os.environ['POSTGRES_PASSWORD']}


def bare_repos(repos_root: Path) -> list[Path]:
    return sorted(repo for repo in repos_root.glob('*/*.git') if (repo / 'HEAD').is_file())


def create() -> None:
    staging = DATA_DIR / STAGING_NAME
    shutil.rmtree(staging, ignore_errors=True)
    bundles_root = staging / BUNDLES_NAME
    bundles_root.mkdir(parents=True)

    subprocess.run(
        [str(PG_BIN / 'pg_dump'), '--format=custom', f'--file={staging / DUMP_NAME}', *postgres_args()],
        env=postgres_env(),
        check=True,
    )

    repos_root = DATA_DIR / 'bare-repos'
    for repo in bare_repos(repos_root):
        if git(repo, 'for-each-ref', '--format=%(refname)').strip() == '':
            continue
        bundle = bundles_root / repo.relative_to(repos_root).with_suffix('.bundle')
        bundle.parent.mkdir(parents=True, exist_ok=True)
        git(repo, '-c', 'pack.threads=1', '-c', 'pack.windowMemory=100m',
            'bundle', 'create', '--quiet', str(bundle), '--all')


def chown_tree(root: Path, uid: int, gid: int) -> None:
    os.chown(root, uid, gid)
    for directory, subdirectories, files in os.walk(root):
        for name in subdirectories + files:
            os.chown(os.path.join(directory, name), uid, gid, follow_symlinks=False)


def restore(root: Path) -> None:
    staging = root / STAGING_NAME
    bundles_root = staging / BUNDLES_NAME
    repos_root = root / 'bare-repos'

    for repo in bare_repos(repos_root):
        (repo / 'objects').mkdir(exist_ok=True)
        (repo / 'refs' / 'heads').mkdir(parents=True, exist_ok=True)
        (repo / 'refs' / 'tags').mkdir(exist_ok=True)
        bundle = bundles_root / repo.relative_to(repos_root).with_suffix('.bundle')
        if bundle.is_file() == True:
            git(repo, 'fetch', '--quiet', '--update-head-ok', str(bundle), '+refs/*:refs/*')
        owner = repo.stat()
        chown_tree(repo, owner.st_uid, owner.st_gid)
        print(f'restored {repo.relative_to(repos_root)}')

    subprocess.run(
        [
            str(PG_BIN / 'pg_restore'),
            '--clean',
            '--if-exists',
            '--exit-on-error',
            *postgres_args(),
            str(staging / DUMP_NAME),
        ],
        env=postgres_env(),
        check=True,
    )
    print('restored postgres')

    shutil.rmtree(staging)


def main() -> None:
    match sys.argv[1:]:
        case ['create']:
            create()
        case ['restore', root]:
            restore(Path(root))
        case _:
            sys.exit('usage: snapshot.py create | snapshot.py restore ROOT')


if __name__ == '__main__':
    main()
