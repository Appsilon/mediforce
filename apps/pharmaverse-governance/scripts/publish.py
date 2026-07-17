#!/usr/bin/env python3
"""Publish pharmaverse-governance to a Mediforce instance (default: phuse.mediforce.ai).

The workflow runs entirely on `mediforce-golden-image` (already on the server) —
script steps are inlined, so there is no custom image to build or transfer.

Pipeline:
  1. Regenerate the self-contained wd.json from source (inline skills + scripts).
  2. Validate it (mediforce workflow register --dry-run).
  3. Set required secrets in the namespace (only those provided via env).
  4. Register the workflow.

Nothing runs against the instance unless MEDIFORCE_API_KEY is set. Use --dry-run
to stop after validation. Registering via the UI (paste the .yaml/.wd.json) is an
equivalent alternative to this script.

Required env:
  MEDIFORCE_API_KEY     API key for the target instance.

Optional env (with defaults):
  MEDIFORCE_BASE_URL    Target instance (default: https://phuse.mediforce.ai)
  NAMESPACE             Owning namespace   (default: pharmaverse)
  VISIBILITY            public | private   (default: private)

Secrets (each set only if the env var is present):
  OPENROUTER_API_KEY    LLM auth for the agent steps.
  GITHUB_TOKEN          GitHub API for the discover/collect steps.

Flags:
  --dry-run             Regenerate + validate only. No secrets, no register.
  --skip-secrets        Don't set any secrets.
  --skip-register       Do everything except the final register call.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent
WD_FILE = PKG / "src" / "pharmaverse-governance.wd.json"
REPO_ROOT = PKG.parent.parent  # mediforce repo root, where `pnpm exec mediforce` resolves

BASE_URL = os.environ.get("MEDIFORCE_BASE_URL", "https://phuse.mediforce.ai")
NAMESPACE = os.environ.get("NAMESPACE", "pharmaverse")
VISIBILITY = os.environ.get("VISIBILITY", "private")
WORKFLOW_NAME = "pharmaverse-governance"

SECRET_ENV_VARS = ["OPENROUTER_API_KEY", "GITHUB_TOKEN"]


def run(cmd, *, cwd=None, input_bytes=None, env=None):
    printable = " ".join(str(c) for c in cmd)
    print(f"\n$ {printable}", flush=True)
    result = subprocess.run(cmd, cwd=cwd, input=input_bytes, env=env, check=False)
    if result.returncode != 0:
        sys.exit(f"FAILED (exit {result.returncode}): {printable}")


def mediforce_env():
    env = dict(os.environ)
    env["MEDIFORCE_BASE_URL"] = BASE_URL
    return env


def step_generate():
    print("== 1. Regenerate wd.json (inline skills + scripts) ==")
    run([sys.executable, str(PKG / "scripts" / "build-wd.py")])


def step_validate():
    print("== 2. Validate (dry-run) ==")
    run(
        ["pnpm", "exec", "mediforce", "workflow", "register",
         "--file", str(WD_FILE), "--namespace", NAMESPACE, "--dry-run"],
        cwd=REPO_ROOT, env=mediforce_env(),
    )


def step_secrets():
    print("== 3. Set secrets ==")
    present = [k for k in SECRET_ENV_VARS if os.environ.get(k)]
    if not present:
        print("   No secret env vars present — skipping. Set OPENROUTER_API_KEY "
              "and/or GITHUB_TOKEN in env to push them.")
        return
    for key in present:
        run(
            ["pnpm", "exec", "mediforce", "secret", "set",
             "--namespace", NAMESPACE, "--key", key, "--stdin"],
            cwd=REPO_ROOT, env=mediforce_env(),
            input_bytes=os.environ[key].encode(),
        )


def step_register():
    print("== 4. Register workflow ==")
    run(
        ["pnpm", "exec", "mediforce", "workflow", "register",
         "--file", str(WD_FILE), "--namespace", NAMESPACE, "--visibility", VISIBILITY],
        cwd=REPO_ROOT, env=mediforce_env(),
    )
    print(f"\nDone. {WORKFLOW_NAME} registered in '{NAMESPACE}' on {BASE_URL}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-secrets", action="store_true")
    parser.add_argument("--skip-register", action="store_true")
    args = parser.parse_args()

    if not args.dry_run and not os.environ.get("MEDIFORCE_API_KEY"):
        sys.exit("MEDIFORCE_API_KEY is required (or pass --dry-run).")

    step_generate()
    step_validate()
    if args.dry_run:
        print("\n--dry-run: stopped after validation. Nothing sent to the instance.")
        return
    if not args.skip_secrets:
        step_secrets()
    if not args.skip_register:
        step_register()


if __name__ == "__main__":
    main()
