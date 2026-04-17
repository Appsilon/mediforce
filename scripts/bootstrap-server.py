#!/usr/bin/env python3
"""Interactive bootstrap for a fresh Hetzner/Ubuntu server hosting mediforce.

Takes a fresh Ubuntu 22.04+ box and brings it to a running deployment.
Every prerequisite follows the same pattern: detect first, offer to use
what was found, otherwise guide the user (clear YOUR TURN / MY TURN
handoffs) through creating or providing it.

Targets the public Appsilon/mediforce repo by default. For private forks
(per-customer deployments), pass --repo Org/Name. Switching an existing
deployment to a different repo is supported: the script rewires the deploy
key and the git remote on the server (renaming the old origin to 'upstream'
so sync flows keep working).

State is persisted at ~/.mediforce/bootstrap-<host>.json so the run is
resumable after Ctrl+C or a network hiccup.

Usage:
    python3 scripts/bootstrap-server.py                                # interactive
    python3 scripts/bootstrap-server.py --host 1.2.3.4
    python3 scripts/bootstrap-server.py --repo Appsilon/mediforce-pharmaverse
    python3 scripts/bootstrap-server.py --branch main --from-step 6
    python3 scripts/bootstrap-server.py --resume                       # force resume prompt
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Callable, Optional

# ──────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────

DEFAULT_REPO = "Appsilon/mediforce"
DEFAULT_BRANCH = "main"
REMOTE_DEPLOY_DIR = "/opt/mediforce"
STATE_DIR = Path.home() / ".mediforce"


def _repo_slug_kebab(repo: str) -> str:
    """Turn 'Org/Repo_Name' into 'org-repo-name' for use in filenames/titles."""
    return re.sub(r"[^a-z0-9]+", "-", repo.lower()).strip("-")

# ──────────────────────────────────────────────────────────────────────────
# Output primitives (color-aware)
# ──────────────────────────────────────────────────────────────────────────

_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def bold(t: str) -> str: return _c("1", t)
def dim(t: str) -> str: return _c("2", t)
def green(t: str) -> str: return _c("32", t)
def yellow(t: str) -> str: return _c("33", t)
def red(t: str) -> str: return _c("31", t)
def cyan(t: str) -> str: return _c("36", t)


def section(title: str) -> None:
    line = "─" * max(0, 60 - len(title))
    print(f"\n{bold(cyan('══'))} {bold(title)} {cyan(line)}")


def info(msg: str) -> None: print(f"  {dim('·')} {msg}")
def ok(msg: str) -> None: print(f"  {green('✓')} {msg}")
def warn(msg: str) -> None: print(f"  {yellow('!')} {msg}")
def error(msg: str) -> None: print(f"  {red('✗')} {msg}")


# ──────────────────────────────────────────────────────────────────────────
# Input primitives
# ──────────────────────────────────────────────────────────────────────────


def ask(prompt: str, default: Optional[str] = None, secret: bool = False,
        validate: Optional[Callable[[str], Optional[str]]] = None) -> str:
    """Ask a free-form question. Returns stripped answer.

    validate: function returning None if ok, or error message string.
    """
    suffix = f" [{default}]" if default else ""
    while True:
        if secret:
            raw = getpass.getpass(f"  {cyan('▸')} {prompt}{suffix}: ")
        else:
            raw = input(f"  {cyan('▸')} {prompt}{suffix}: ")
        answer = raw.strip() or (default or "")
        if not answer:
            error("A value is required.")
            continue
        if validate:
            err = validate(answer)
            if err:
                error(err)
                continue
        return answer


def confirm(prompt: str, default: bool = True) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    while True:
        raw = input(f"  {cyan('▸')} {prompt} {suffix} ").strip().lower()
        if not raw:
            return default
        if raw in ("y", "yes"): return True
        if raw in ("n", "no"): return False
        error("Please answer y or n.")


def menu(prompt: str, options: list[tuple[str, str]],
         allow_other: bool = False) -> str:
    """Pick one of (value, label) options. Returns value.

    If allow_other, appends an "other — type your own" choice.
    """
    print(f"  {cyan('▸')} {prompt}")
    for i, (_, label) in enumerate(options, 1):
        print(f"      {i}. {label}")
    if allow_other:
        print(f"      {len(options) + 1}. other — type your own")
    while True:
        raw = input(f"    choice [1-{len(options) + (1 if allow_other else 0)}]: ").strip()
        if not raw.isdigit():
            error("Enter a number.")
            continue
        idx = int(raw)
        if 1 <= idx <= len(options):
            return options[idx - 1][0]
        if allow_other and idx == len(options) + 1:
            return ask("value")
        error("Out of range.")


def handoff(
    what: str,
    where: str,
    steps: list[str],
    verify: Callable[[], tuple[bool, str]],
    save_to: Optional[str] = None,
) -> bool:
    """Clear ball-handoff to the user. Returns True when verify succeeds.

    Loops with retry/help/abort options on verify failure.
    """
    while True:
        print()
        print(f"  {bold(yellow('── YOUR TURN ─────────────────────────────────────────'))}")
        print(f"  {bold('What:')}  {what}")
        print(f"  {bold('Where:')} {where}")
        if save_to:
            print(f"  {bold('Save to:')} {save_to}")
        print(f"  {bold('Steps:')}")
        for i, stp in enumerate(steps, 1):
            print(f"     {i}. {stp}")
        print(f"\n  Press Enter when done (q=abort) ", end="", flush=True)
        raw = input().strip().lower()
        if raw == "q":
            raise KeyboardInterrupt("aborted at handoff")

        print(f"\n  {bold(cyan('── MY TURN ──────────────────────────────────────────'))}")
        passed, msg = verify()
        if passed:
            ok(msg)
            return True
        error(msg)
        choice = menu(
            "What next?",
            [
                ("retry", "Retry — I did it now"),
                ("help", "Show the instructions again"),
                ("abort", "Abort"),
            ],
        )
        if choice == "abort":
            raise KeyboardInterrupt("aborted after handoff failure")
        if choice == "retry":
            continue  # re-runs verify via outer loop
        if choice == "help":
            continue  # prints handoff block again


# ──────────────────────────────────────────────────────────────────────────
# Subprocess helpers
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class RunResult:
    rc: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool: return self.rc == 0


def run(cmd: list[str] | str, input_: Optional[str] = None,
        check: bool = False, capture: bool = True) -> RunResult:
    if isinstance(cmd, str):
        cmd_list = shlex.split(cmd)
    else:
        cmd_list = cmd
    proc = subprocess.run(
        cmd_list,
        input=input_,
        text=True,
        capture_output=capture,
    )
    result = RunResult(proc.returncode, proc.stdout or "", proc.stderr or "")
    if check and not result.ok:
        raise RuntimeError(
            f"command failed ({result.rc}): {' '.join(cmd_list)}\n{result.stderr}"
        )
    return result


def _sudo_prefix(ctx: "Context") -> str:
    """Empty when connected as root, 'sudo ' otherwise. Deploy has NOPASSWD sudo."""
    return "" if ctx.user == "root" else "sudo "


def _ssh_base_opts(ctx: "Context") -> list[str]:
    """Common SSH options, including ControlMaster multiplexing so follow-up
    calls to the same host reuse the first TCP/SSH handshake. Cuts overall
    bootstrap time by several seconds on a slow RTT.

    StrictHostKeyChecking=accept-new is pragmatic for a fresh server we're
    about to configure — trust-on-first-use, prints the host key once, then
    pins it in ~/.ssh/known_hosts for later runs.
    """
    return [
        "-i", str(ctx.ssh_key_path),
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        "-o", "ControlMaster=auto",
        "-o", f"ControlPath={tempfile.gettempdir()}/mediforce-ssh-%r@%h:%p",
        "-o", "ControlPersist=60",
    ]


def ssh(ctx: "Context", remote_cmd: str, *, check: bool = False,
        capture: bool = True, stream: bool = False) -> RunResult:
    base = ["ssh", *_ssh_base_opts(ctx), f"{ctx.user}@{ctx.host}", remote_cmd]
    if stream:
        proc = subprocess.run(base)
        return RunResult(proc.returncode, "", "")
    return run(base, check=check, capture=capture)


def scp_upload(ctx: "Context", local: Path, remote: str,
               mode: Optional[str] = None) -> None:
    assert local.exists(), f"local file missing: {local}"
    cmd = ["scp", *_ssh_base_opts(ctx), str(local), f"{ctx.user}@{ctx.host}:{remote}"]
    result = run(cmd)
    if not result.ok:
        raise RuntimeError(f"scp failed: {result.stderr}")
    if mode:
        ssh(ctx, f"chmod {mode} {shlex.quote(remote)}", check=True)


def _safe_host_slug(host: str) -> str:
    """Sanitize a host string for use in filenames and shell-embedded strings.

    Keeps letters, digits, dot, dash, underscore. Typical hostnames and IPv4
    addresses pass through unchanged; anything else becomes `_`. Protects
    against path traversal in state filenames and argv injection in the deploy
    key comment passed to ssh-keygen.
    """
    return re.sub(r"[^A-Za-z0-9._-]", "_", host)


# ──────────────────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class State:
    """Persisted between runs. Never contains raw secret values."""
    host: str = ""
    user: str = "root"
    ssh_key_path: str = ""
    repo: str = ""
    branch: str = DEFAULT_BRANCH
    github_deploy_key_id: Optional[int] = None
    firebase_account: str = ""
    firebase_project_id: str = ""
    firebase_web_config: dict = field(default_factory=dict)
    firebase_sa_path: str = ""
    domain: str = ""
    completed_steps: list[str] = field(default_factory=list)
    last_step: str = ""
    started_at: str = ""

    @classmethod
    def load(cls, host: str) -> "State":
        path = STATE_DIR / f"bootstrap-{_safe_host_slug(host)}.json"
        if not path.exists():
            return cls(host=host, started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        raw = json.loads(path.read_text())
        # Forgiving loader: ignore unknown keys (older state files from before a field
        # was removed) and let missing keys fall back to the dataclass defaults.
        known = {f.name for f in fields(cls)}
        filtered = {k: v for k, v in raw.items() if k in known}
        return cls(**filtered)

    def save(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        path = STATE_DIR / f"bootstrap-{_safe_host_slug(self.host)}.json"
        path.write_text(json.dumps(self.__dict__, indent=2))
        path.chmod(0o600)

    def mark(self, step_name: str) -> None:
        if step_name not in self.completed_steps:
            self.completed_steps.append(step_name)
        self.last_step = step_name
        self.save()


# ──────────────────────────────────────────────────────────────────────────
# Context passed to every step
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class Context:
    host: str = ""
    user: str = "root"
    ssh_key_path: Path = Path()
    state: State = field(default_factory=State)
    dry_run: bool = False
    # Values collected during run (not persisted unless on disk already)
    collected: dict = field(default_factory=dict)


# ──────────────────────────────────────────────────────────────────────────
# Steps — stubs for now, filled in subsequent chunks
# ──────────────────────────────────────────────────────────────────────────


REQUIRED_LOCAL_TOOLS = ["ssh", "scp", "git", "curl"]
OPTIONAL_LOCAL_TOOLS = {
    "gh": {
        "why": "registers the server's deploy key with the GitHub repo (step 6)",
        "install_darwin": "brew install gh",
        "install_linux": "see https://github.com/cli/cli#installation",
    },
    "firebase": {
        "why": "lists/creates Firebase projects and pulls client config (step 8)",
        "install_darwin": "npm install -g firebase-tools",
        "install_linux": "npm install -g firebase-tools",
    },
}


def step_local_prereqs(ctx: Context) -> None:
    missing_required = [t for t in REQUIRED_LOCAL_TOOLS if shutil.which(t) is None]
    if missing_required:
        error(f"Missing required local tools: {', '.join(missing_required)}")
        info("Install them (e.g. `xcode-select --install` on macOS) and re-run.")
        raise SystemExit(1)
    for tool in REQUIRED_LOCAL_TOOLS:
        ok(f"{tool}  — found at {shutil.which(tool)}")

    is_mac = sys.platform == "darwin"
    for tool, meta in OPTIONAL_LOCAL_TOOLS.items():
        if shutil.which(tool):
            ok(f"{tool}  — found at {shutil.which(tool)}")
            continue
        warn(f"{tool} not installed — needed to: {meta['why']}")
        hint = meta["install_darwin"] if is_mac else meta["install_linux"]
        info(f"Install hint: {hint}")
        if is_mac and hint.startswith("brew ") and shutil.which("brew"):
            if confirm(f"Run `{hint}` now?", default=True):
                if ctx.dry_run:
                    info(f"[dry-run] would run: {hint}")
                else:
                    run(hint, capture=False)
                    if shutil.which(tool) is None:
                        warn(f"{tool} still not found after install — continue anyway; step using it will re-check.")
        else:
            info("Install it yourself before the step that needs it, or continue and we'll halt there.")


def _list_local_ssh_keys() -> list[Path]:
    """Return private-key paths in ~/.ssh that have a matching .pub."""
    ssh_dir = Path.home() / ".ssh"
    if not ssh_dir.is_dir():
        return []
    keys: list[Path] = []
    for entry in sorted(ssh_dir.iterdir()):
        if not entry.is_file():
            continue
        if entry.suffix in (".pub", ".old", ".bak"):
            continue
        pub = entry.with_suffix(entry.suffix + ".pub") if entry.suffix else entry.with_name(entry.name + ".pub")
        if pub.exists():
            keys.append(entry)
    return keys


def _test_ssh(ctx: Context) -> RunResult:
    """Lightweight connectivity + OS probe."""
    return ssh(ctx, "whoami && lsb_release -rs 2>/dev/null || cat /etc/os-release", capture=True)


def _generate_ssh_key(host: str) -> Path:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", host).strip("_") or "server"
    target = Path.home() / ".ssh" / f"mediforce_{slug}_deploy"
    if target.exists():
        info(f"{target} already exists — reusing.")
        return target
    info(f"Generating ed25519 key at {target}")
    run(
        ["ssh-keygen", "-t", "ed25519", "-f", str(target), "-N", "",
         "-C", f"mediforce-bootstrap-{slug}-{time.strftime('%Y%m%d')}"],
        check=True,
        capture=False,
    )
    return target


def step_target_server(ctx: Context) -> None:
    # Resolve the SSH key to use.
    if not ctx.ssh_key_path or not ctx.ssh_key_path.exists():
        print()
        info("The bootstrap needs an SSH private key that can log into the target server.")
        detected = _list_local_ssh_keys()

        if confirm("Do you already have an SSH key for this server?", default=bool(detected)):
            if detected:
                options: list[tuple[str, str]] = [
                    (str(k), f"use {k.name}  ({k})") for k in detected
                ]
                options.append(("__provide__", "enter a path to a different key"))
                choice = menu("Which key?", options)
            else:
                choice = "__provide__"
            if choice == "__provide__":
                raw = ask(
                    "Path to private key",
                    validate=lambda p: None if Path(p).expanduser().exists() else "file not found",
                )
                ctx.ssh_key_path = Path(raw).expanduser()
            else:
                ctx.ssh_key_path = Path(choice)
        else:
            info("OK — I'll generate a new ed25519 key and walk you through installing the public half on the server.")
            ctx.ssh_key_path = _generate_ssh_key(ctx.host)

        ctx.state.ssh_key_path = str(ctx.ssh_key_path)
        ctx.state.save()
    ok(f"using SSH key: {ctx.ssh_key_path}")

    # Probe connectivity.
    result = _test_ssh(ctx)
    if not result.ok:
        warn("SSH probe failed — need to install the key on the server first.")
        pub_path = ctx.ssh_key_path.with_name(ctx.ssh_key_path.name + ".pub")
        pub = pub_path.read_text().strip() if pub_path.exists() else "(pub key file missing!)"
        print()
        print(f"  {bold('Public key to add:')}")
        print(f"  {dim(pub)}")
        print()
        def _verify_ssh() -> tuple[bool, str]:
            r = _test_ssh(ctx)
            if r.ok:
                return True, "SSH probe now works."
            return False, f"SSH still fails: {r.stderr.strip()[:200]}"

        handoff(
            what=f"Authorize this key on {ctx.user}@{ctx.host}",
            where="Hetzner Cloud Console → Servers → your server → details, or SSH in with an existing credential",
            steps=[
                "Option A (Hetzner Cloud Console): add the key above under Security → SSH Keys, then rebuild the server or attach it during creation",
                "Option B (existing root access): append the pub key above to /root/.ssh/authorized_keys on the server",
                f"Option C (ssh-copy-id if password auth is allowed): ssh-copy-id -i {ctx.ssh_key_path}.pub {ctx.user}@{ctx.host}",
            ],
            verify=_verify_ssh,
        )
        result = _test_ssh(ctx)

    # Parse OS info.
    stdout = result.stdout.strip().splitlines()
    remote_user = stdout[0] if stdout else "?"
    remainder = " ".join(stdout[1:]) if len(stdout) > 1 else ""
    ok(f"connected as {remote_user}@{ctx.host}")

    version_match = re.search(r"VERSION_ID=\"?(\d+)\.(\d+)\"?", remainder) or \
                    re.match(r"^\s*(\d+)\.(\d+)", remainder)
    if version_match:
        major, minor = int(version_match.group(1)), int(version_match.group(2))
        if major < 22:
            warn(f"OS appears to be Ubuntu {major}.{minor} — this script targets 22.04+; continue at your own risk.")
            if not confirm("Continue anyway?", default=False):
                raise SystemExit(1)
        else:
            ok(f"Ubuntu {major}.{minor} — supported")
    else:
        warn(f"Couldn't parse OS version from probe; proceeding. (raw: {remainder[:120]})")


BASE_PACKAGES = [
    "git", "curl", "ca-certificates", "gnupg", "lsb-release",
    "ufw", "jq", "unzip",
]

APT_ENV = "export DEBIAN_FRONTEND=noninteractive"


def _apt_install(ctx: Context, packages: list[str]) -> None:
    cmd = f"{APT_ENV} && apt-get install -y {' '.join(packages)}"
    result = ssh(ctx, cmd, capture=False, stream=True)
    if result.rc != 0:
        raise RuntimeError(f"apt-get install failed (rc={result.rc})")


def step_system_packages(ctx: Context) -> None:
    missing_cmd = (
        "missing=(); for p in " + " ".join(BASE_PACKAGES) + "; do "
        "dpkg -s \"$p\" >/dev/null 2>&1 || missing+=(\"$p\"); done; "
        "echo \"${missing[@]}\""
    )
    result = ssh(ctx, missing_cmd, check=True)
    missing = result.stdout.strip().split()
    if not missing:
        ok("all base packages already installed")
        return
    info(f"Missing: {', '.join(missing)}")
    if ctx.dry_run:
        info(f"[dry-run] would apt-get update && install: {' '.join(missing)}")
        return
    info("Running apt-get update …")
    update = ssh(ctx, f"{APT_ENV} && apt-get update -qq", capture=False, stream=True)
    if update.rc != 0:
        raise RuntimeError(f"apt-get update failed (rc={update.rc})")
    info(f"Installing {len(missing)} package(s) …")
    _apt_install(ctx, missing)
    ok(f"installed: {', '.join(missing)}")


def step_docker(ctx: Context) -> None:
    probe = ssh(ctx, "docker --version 2>/dev/null; docker compose version 2>/dev/null")
    lines = [line for line in probe.stdout.strip().splitlines() if line]
    if len(lines) >= 2:
        for line in lines:
            ok(line)
        return
    info("Docker not installed — installing from Docker's official apt repository.")
    if ctx.dry_run:
        info("[dry-run] would install docker-ce, docker-compose-plugin, etc.")
        return
    script = r"""
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
arch=$(dpkg --print-architecture)
echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $codename stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
"""
    result = ssh(ctx, script, capture=False, stream=True)
    if result.rc != 0:
        raise RuntimeError(f"docker install failed (rc={result.rc})")
    verify = ssh(ctx, "docker --version && docker compose version", check=True)
    for line in verify.stdout.strip().splitlines():
        ok(line)


def step_deploy_user(ctx: Context) -> None:
    probe = ssh(ctx, "getent passwd deploy || true")
    if probe.stdout.strip():
        ok("user 'deploy' already exists")
    else:
        info("About to create a 'deploy' user with the following privileges:")
        info("  • home dir /home/deploy, shell /bin/bash")
        info("  • groups:   docker (can run docker without sudo)")
        info("              sudo   (member of the sudo group)")
        info("  • ssh:      authorized_keys copied from /root/.ssh/authorized_keys")
        info("              → the same SSH key that reaches root will reach deploy")
        warn("  • sudoers:  NOPASSWD:ALL — deploy can become root without a password.")
        warn("              This is a trust decision. The script needs it so deploy.sh")
        warn("              can manage Docker + CI-style restarts non-interactively.")
        if not confirm("Create deploy user with these privileges?", default=True):
            raise SystemExit("aborted at deploy-user creation")
        if ctx.dry_run:
            info("[dry-run] would: useradd -m -s /bin/bash -G docker,sudo deploy")
            return
        ssh(ctx, "useradd -m -s /bin/bash -G docker,sudo deploy", check=True)
        ssh(ctx,
            "mkdir -p /home/deploy/.ssh && "
            "chmod 700 /home/deploy/.ssh && "
            "cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys && "
            "chmod 600 /home/deploy/.ssh/authorized_keys && "
            "chown -R deploy:deploy /home/deploy/.ssh",
            check=True)
        ssh(ctx,
            "echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy && "
            "chmod 0440 /etc/sudoers.d/deploy",
            check=True)
        ok("deploy user created, authorized_keys copied, sudoers configured")

    # deploy.sh tees to /var/log/mediforce-deploy.log. Ensure it exists and is
    # writable by deploy so subsequent re-runs from step 12 can be done as the
    # deploy user without needing root on the shell side. Idempotent: does not
    # truncate an existing log with history.
    ssh(ctx,
        "touch /var/log/mediforce-deploy.log && "
        "chown deploy:deploy /var/log/mediforce-deploy.log && "
        "chmod 0644 /var/log/mediforce-deploy.log",
        check=True)
    ok("/var/log/mediforce-deploy.log writable by deploy")

    # Sanity check: deploy can docker ps and ssh back.
    check = ssh(ctx, "sudo -u deploy -H bash -c 'groups && docker ps >/dev/null && echo DOCKER_OK'")
    if "DOCKER_OK" not in check.stdout:
        warn(f"deploy user cannot run docker yet: {check.stdout.strip()} / {check.stderr.strip()}")
        info("If this is a freshly-added group membership, a re-login is required — moving on.")
    else:
        ok("deploy can run docker")


def _deploy_key_title(ctx: Context) -> str:
    # Repo slug in title so targeting a different fork from the same host
    # doesn't collide at title-match lookup. Host is sanitized because it
    # flows into an ssh-keygen -C argument inside a nested bash -c '…' string.
    return f"mediforce-bootstrap-{_safe_host_slug(ctx.host)}-{_repo_slug_kebab(ctx.state.repo)}"


def _gh_auth_ok() -> bool:
    return run(["gh", "auth", "status"], check=False).ok


def step_github_access(ctx: Context) -> None:
    # Ensure local gh is authenticated.
    if not shutil.which("gh"):
        error("`gh` CLI missing locally — install it (e.g. `brew install gh`) and re-run step 6.")
        raise SystemExit(1)
    if not _gh_auth_ok():
        info("gh is not authenticated on this machine.")
        if not confirm("Run `gh auth login` now?", default=True):
            raise SystemExit("gh auth required to register deploy keys")
        run(["gh", "auth", "login"], capture=False)
        if not _gh_auth_ok():
            raise SystemExit("gh auth still failing — abort")
    ok("gh authenticated locally")

    # Ensure deploy key exists on server (as deploy user).
    key_path = "/home/deploy/.ssh/github_deploy"
    probe = ssh(ctx, f"sudo -u deploy test -f {key_path} && echo HAVE || echo NONE")
    if "HAVE" in probe.stdout:
        info(f"Deploy key already present at {key_path}")
    else:
        if ctx.dry_run:
            info(f"[dry-run] would ssh-keygen at {key_path}")
            return
        info("Generating ed25519 deploy key on server (as deploy user)")
        ssh(ctx,
            "sudo -u deploy bash -c '"
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
            f"ssh-keygen -t ed25519 -f {key_path} -N \"\" -C \"{_deploy_key_title(ctx)}\" "
            "'",
            check=True)
        # Add github.com to known_hosts so no interactive prompt later.
        ssh(ctx,
            "sudo -u deploy bash -c '"
            "ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null && "
            "chmod 600 ~/.ssh/known_hosts'",
            check=True)
        # Configure ssh so `git` uses this key for github.com without extra env.
        ssh(ctx,
            "sudo -u deploy bash -c '"
            "printf \"Host github.com\\n  IdentityFile %s\\n  IdentitiesOnly yes\\n\" "
            f"{key_path} > ~/.ssh/config && chmod 600 ~/.ssh/config'",
            check=True)
        ok("deploy key generated + ssh config written")

    # Pull the public key.
    pub = ssh(ctx, f"sudo -u deploy cat {key_path}.pub", check=True).stdout.strip()

    # Check if already registered in repo (match by title).
    repo = ctx.state.repo
    title = _deploy_key_title(ctx)
    existing = run(["gh", "api", f"repos/{repo}/keys", "--paginate"], check=True)
    registered_id: Optional[int] = None
    for entry in json.loads(existing.stdout):
        if entry.get("title") == title:
            registered_id = entry["id"]
            break
    if registered_id is not None:
        ctx.state.github_deploy_key_id = registered_id
        ctx.state.save()
        ok(f"deploy key already registered on {repo} (id={registered_id})")
    else:
        if ctx.dry_run:
            info(f"[dry-run] would POST key '{title}' to repos/{repo}/keys")
        else:
            info(f"Registering deploy key on {repo} as '{title}'")
            result = run(
                ["gh", "api", "-X", "POST", f"repos/{repo}/keys",
                 "-f", f"title={title}",
                 "-f", f"key={pub}",
                 "-F", "read_only=true"],
                check=True,
            )
            data = json.loads(result.stdout)
            ctx.state.github_deploy_key_id = data.get("id")
            ctx.state.save()
            ok(f"registered (id={data.get('id')}, read-only)")

    # End-to-end: can deploy user talk to GitHub?
    test = ssh(ctx, "sudo -u deploy ssh -T git@github.com 2>&1 || true")
    if "successfully authenticated" in test.stdout.lower():
        ok("deploy user can authenticate to github.com")
    else:
        warn(f"github auth probe returned: {test.stdout.strip()[:200]}")
        if not confirm("Continue anyway?", default=True):
            raise SystemExit("github key not working")


def _deploy_git(ctx: Context, git_cmd: str, *, check: bool = False,
                capture: bool = True, stream: bool = False) -> RunResult:
    """Run a git command as the deploy user inside REMOTE_DEPLOY_DIR."""
    wrapped = f"sudo -u deploy bash -c 'cd {REMOTE_DEPLOY_DIR} && git {git_cmd}'"
    return ssh(ctx, wrapped, check=check, capture=capture, stream=stream)


def step_clone_repo(ctx: Context) -> None:
    repo = ctx.state.repo
    branch = ctx.state.branch or DEFAULT_BRANCH
    expected_url = f"git@github.com:{repo}.git"

    probe = ssh(ctx, f"test -d {REMOTE_DEPLOY_DIR}/.git && echo HAVE || echo NONE")
    if "HAVE" in probe.stdout:
        current_url = _deploy_git(ctx, "remote get-url origin", check=True).stdout.strip()
        current_branch = _deploy_git(ctx, "rev-parse --abbrev-ref HEAD", check=True).stdout.strip()

        if current_url == expected_url:
            ok(f"repo already cloned at {REMOTE_DEPLOY_DIR} (origin={repo}, branch={current_branch})")
        else:
            warn(f"Existing clone points to a different remote:")
            info(f"  current origin: {current_url}")
            info(f"  configured:     {expected_url}")
            choice = menu(
                "Switch remote?",
                [
                    ("re-remote", "Rename current 'origin' to 'upstream', set origin to configured repo"),
                    ("abort",     "Abort — I want to change --repo instead"),
                ],
            )
            if choice == "abort":
                raise SystemExit("aborted — existing clone points to a different repo")
            if ctx.dry_run:
                info(f"[dry-run] would rename origin→upstream and set origin to {expected_url}")
                return
            # If an 'upstream' remote already exists (previous re-remote), drop it
            # to make room for the rename.
            existing_upstream = _deploy_git(ctx, "remote get-url upstream 2>/dev/null || true")
            if existing_upstream.stdout.strip():
                info(f"removing pre-existing upstream remote ({existing_upstream.stdout.strip()})")
                _deploy_git(ctx, "remote remove upstream", check=True)
            _deploy_git(ctx, "remote rename origin upstream", check=True)
            _deploy_git(ctx, f"remote add origin {expected_url}", check=True)
            ok(f"origin → {expected_url}, previous origin preserved as 'upstream'")
            # Invalidate old deploy-key id — it belonged to the previous repo.
            ctx.state.github_deploy_key_id = None
            ctx.state.save()
            # Verify we can fetch from the new origin.
            fetch = _deploy_git(ctx, "fetch origin", capture=False, stream=True)
            if fetch.rc != 0:
                raise RuntimeError(
                    "fetch from new origin failed — is the deploy key registered on the new repo?"
                )
            ok("fetch from new origin succeeded")

        # Align branch if it differs from configured.
        current_branch = _deploy_git(ctx, "rev-parse --abbrev-ref HEAD", check=True).stdout.strip()
        if current_branch != branch:
            warn(f"Current checkout is {current_branch!r}, configured branch is {branch!r}")
            if confirm(f"Check out {branch!r}?", default=True):
                _deploy_git(ctx, f"fetch origin {branch}", check=True)
                _deploy_git(ctx, f"checkout {branch}", check=True)
                ok(f"checked out {branch}")
        return

    if ctx.dry_run:
        info(f"[dry-run] would clone {expected_url} (branch {branch}) to {REMOTE_DEPLOY_DIR}")
        return
    info(f"Cloning {repo} (branch {branch}) into {REMOTE_DEPLOY_DIR}")
    ssh(ctx, f"mkdir -p {REMOTE_DEPLOY_DIR} && chown deploy:deploy {REMOTE_DEPLOY_DIR}", check=True)
    ssh(ctx,
        f"sudo -u deploy git clone --branch {shlex.quote(branch)} {expected_url} {REMOTE_DEPLOY_DIR}",
        capture=False, stream=True, check=False)
    verify = _deploy_git(ctx, "rev-parse HEAD")
    if not verify.ok or not verify.stdout.strip():
        raise RuntimeError(f"clone verification failed: {verify.stderr.strip()[:200]}")
    sha = verify.stdout.strip()[:12]
    ok(f"cloned at {sha}")


FIREBASE_CONFIG_FIELDS = [
    "apiKey", "authDomain", "projectId",
    "storageBucket", "messagingSenderId", "appId",
]


def _fb(account: str, *args: str) -> list[str]:
    """Build a firebase CLI invocation, optionally scoped to an account."""
    base = ["firebase"]
    if account:
        base += ["--account", account]
    return base + list(args)


def _firebase_login_accounts() -> tuple[Optional[str], list[str]]:
    """Return (active_account, other_accounts). Both None/[] if nobody is logged in.

    Parses the plain-text output of `firebase login:list`. The CLI doesn't have
    a --json variant for this subcommand as of firebase-tools 13.x, so format
    changes in a future release would break this. If that happens, the caller
    will see (None, []) and fall through to the login-add flow; we additionally
    print the raw output as a debugging aid so the operator can recognize drift.
    """
    result = run(["firebase", "login:list"], check=False)
    text = (result.stdout or "") + "\n" + (result.stderr or "")
    active_match = re.search(r"Logged in as\s+([\w.+\-]+@[\w.\-]+)", text)
    others = re.findall(r"^\s*-\s+([\w.+\-]+@[\w.\-]+)", text, re.MULTILINE)
    if active_match or others:
        return (active_match.group(1) if active_match else None), others
    if "no authorized accounts" in text.lower() or "not currently logged in" in text.lower():
        return None, []
    # Neither matches nor known "nothing logged in" marker — could be a CLI
    # format change. Surface the raw output so the operator can see.
    warn("Couldn't parse `firebase login:list` output — the CLI format may have changed.")
    info(f"Raw output (first 300 chars): {text[:300]!r}")
    return None, []


def _firebase_list_projects(account: str) -> list[dict]:
    result = run(_fb(account, "projects:list", "--json"), check=True)
    data = json.loads(result.stdout)
    return data.get("result", [])


def _firebase_pick_account(ctx: Context) -> str:
    """Make user pick a Google account for the rest of the Firebase flow."""
    active, others = _firebase_login_accounts()
    while True:
        options: list[tuple[str, str]] = []
        if active:
            options.append((active, f"{active}  (currently active)"))
        for email in others:
            options.append((email, email))
        options.append(("__add__", "add a different Google account (firebase login:add)"))
        if not active and not others:
            info("No Firebase accounts on this machine yet — adding one now.")
            run(["firebase", "login"], capture=False)
            active, others = _firebase_login_accounts()
            continue
        choice = menu("Which Google account should Firebase use?", options)
        if choice == "__add__":
            run(["firebase", "login:add"], capture=False)
            active, others = _firebase_login_accounts()
            continue
        return choice


def step_firebase(ctx: Context) -> None:
    if not shutil.which("firebase"):
        error("`firebase` CLI not installed — run step 1's install hint and retry this step.")
        raise SystemExit(1)

    # Pick the Google account to use.
    account = ctx.state.firebase_account
    if account:
        info(f"Using Firebase account from state: {account}")
        if not confirm("Keep using this account?", default=True):
            account = ""
    if not account:
        account = _firebase_pick_account(ctx)
        ctx.state.firebase_account = account
        ctx.state.save()
    ok(f"firebase account: {account}")

    # Pick or create a project — scoped to the chosen account.
    project_id = ctx.state.firebase_project_id
    if project_id:
        info(f"Using Firebase project from state: {project_id}")
    else:
        projects = _firebase_list_projects(account)
        if not projects:
            info("No Firebase projects visible to this account — you'll need to create one.")
            project_id = _firebase_create_project_flow(ctx, account)
        else:
            options = [(p["projectId"], f"{p.get('displayName') or p['projectId']} ({p['projectId']})")
                       for p in projects]
            options.append(("__new__", "create a new project"))
            options.append(("__manual__", "enter a project ID manually"))
            choice = menu("Which Firebase project for this deployment?", options)
            if choice == "__new__":
                project_id = _firebase_create_project_flow(ctx, account)
            elif choice == "__manual__":
                project_id = ask("Firebase project ID")
            else:
                project_id = choice
        ctx.state.firebase_project_id = project_id
        ctx.state.save()
        ok(f"selected project: {project_id}")

    # Ensure a web app exists and pull its SDK config.
    config = _firebase_get_web_config(ctx, account, project_id)
    missing = [k for k in FIREBASE_CONFIG_FIELDS if not config.get(k)]
    if missing:
        warn(f"Web SDK config is missing fields: {missing} — step 10 will halt if these are required.")
    ctx.collected["firebase_config"] = config
    ctx.state.firebase_web_config = config
    ctx.state.save()
    ok("web SDK config captured ({} fields, persisted to state)".format(
        sum(1 for k in FIREBASE_CONFIG_FIELDS if config.get(k))
    ))


def _firebase_create_project_flow(ctx: Context, account: str) -> str:
    suggested = ask(
        "New project ID (lowercase, hyphens, 6-30 chars)",
        default=f"mediforce-{re.sub(r'[^a-z0-9]+', '-', ctx.host.lower()).strip('-')[:20]}",
        validate=lambda s: None if re.fullmatch(r"[a-z][a-z0-9-]{5,29}", s) else "must be lowercase a-z, 0-9, hyphens, 6-30 chars",
    )
    display = ask("Display name", default=suggested.replace("-", " ").title())
    info(f"Creating Firebase project {suggested!r} — this can fail if the project-id is taken or you hit the 'projects per account' quota.")
    result = run(
        _fb(account, "projects:create", suggested, "--display-name", display),
        check=False, capture=False,
    )
    if not result.ok:
        def _verify_project_visible() -> tuple[bool, str]:
            visible = any(p["projectId"] == suggested for p in _firebase_list_projects(account))
            if visible:
                return True, f"Project {suggested!r} visible to firebase CLI"
            return False, f"Still don't see project {suggested!r} — make sure it's created under {account}"

        handoff(
            what="Create the Firebase project manually",
            where="https://console.firebase.google.com/",
            steps=[
                f"Make sure you're signed in as {account}",
                "Click 'Add project'",
                f"Use project ID: {suggested}",
                f"Display name: {display}",
                "Complete the creation wizard (Google Analytics is optional)",
            ],
            verify=_verify_project_visible,
        )
    return suggested


def _firebase_get_web_config(ctx: Context, account: str, project_id: str) -> dict:
    result = run(
        _fb(account, "apps:sdkconfig", "web", "--project", project_id, "--json"),
        check=False,
    )
    if result.ok:
        payload = json.loads(result.stdout)
        # CLI returns { "status":..., "result": { "sdkConfig": {...} } }
        cfg = payload.get("result", {}).get("sdkConfig") or payload.get("result", {})
        if cfg.get("projectId"):
            return cfg

    # No web app — create one.
    info("No web app registered on this project — creating one")
    app_nick = f"mediforce-{re.sub(r'[^a-z0-9-]+', '-', project_id)}-web"
    create = run(
        _fb(account, "apps:create", "web", app_nick, "--project", project_id),
        check=False, capture=False,
    )
    if not create.ok:
        def _verify_web_app() -> tuple[bool, str]:
            r = run(_fb(account, "apps:sdkconfig", "web", "--project", project_id, "--json"), check=False)
            if r.ok:
                return True, "web app now registered"
            return False, "still no web app — try again in the Console"

        handoff(
            what="Register a Web app on the Firebase project",
            where=f"https://console.firebase.google.com/project/{project_id}/settings/general",
            steps=[
                "Scroll to 'Your apps' section",
                "Click the Web icon (</>)",
                f"Give it a nickname (e.g. '{app_nick}')",
                "Skip Firebase Hosting setup (we run our own)",
                "Click 'Register app'",
            ],
            verify=_verify_web_app,
        )

    retry = run(
        _fb(account, "apps:sdkconfig", "web", "--project", project_id, "--json"),
        check=True,
    )
    payload = json.loads(retry.stdout)
    return payload.get("result", {}).get("sdkConfig") or payload.get("result", {})


def _looks_like_key(value: str, prefix: str) -> Optional[str]:
    if not value.startswith(prefix):
        return f"expected key starting with {prefix!r}"
    if len(value) < len(prefix) + 16:
        return "key looks too short"
    return None


def step_api_keys(ctx: Context) -> None:
    _ensure_api_keys(ctx)


def _resolve_a_records(domain: str) -> list[str]:
    """Return IPv4 A records for `domain` (empty list on failure or none)."""
    result = run(["dig", "+short", "A", domain], check=False)
    if not result.ok:
        return []
    ips: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", line):
            ips.append(line)
    return ips


def step_domain(ctx: Context) -> None:
    existing = ctx.state.domain
    if existing:
        info(f"Domain from state: {existing}")
        if confirm("Keep using this domain?", default=True):
            ctx.collected["domain"] = existing
            ok(f"using domain: {existing}")
            return
        ctx.state.domain = ""
        ctx.state.save()

    info("A real domain gives you a Let's Encrypt TLS cert automatically via Caddy.")
    info("Without one, Caddy serves a self-signed cert and browsers will show a warning.")
    if not confirm("Do you have a domain pointing to this server?", default=True):
        ctx.collected["domain"] = ""
        warn("No domain — will use IP with self-signed TLS.")
        return

    while True:
        domain = ask(
            "Domain (e.g. app.example.com)",
            validate=lambda s: None if re.fullmatch(r"[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+", s) else "doesn't look like a valid hostname",
        )
        ips = _resolve_a_records(domain)
        if not ips:
            warn(f"{domain} doesn't resolve to any A record yet (DNS may be propagating or not set).")
            choice = menu(
                "What next?",
                [
                    ("retry", "Retry after setting/propagating DNS"),
                    ("continue", "Continue anyway (ACME HTTP-01 will fail until DNS is correct — Caddy will retry)"),
                    ("change", "Type a different domain"),
                ],
            )
            if choice == "retry":
                continue
            if choice == "change":
                continue
            # fall through to save with warning
        else:
            if ctx.host == domain:
                matches = True
            elif re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ctx.host):
                matches = ctx.host in ips
            else:
                host_ips = _resolve_a_records(ctx.host)
                matches = bool(set(host_ips) & set(ips))
            if not matches:
                warn(f"{domain} resolves to {ips} but target host is {ctx.host}.")
                choice = menu(
                    "What next?",
                    [
                        ("retry", "Retry (I'll fix DNS)"),
                        ("continue", "Continue anyway (Caddy's cert will fail until DNS matches)"),
                        ("change", "Type a different domain"),
                    ],
                )
                if choice == "retry":
                    continue
                if choice == "change":
                    continue
            else:
                ok(f"{domain} resolves to {ips}")

        ctx.state.domain = domain
        ctx.state.save()
        ctx.collected["domain"] = domain
        ok(f"domain set: {domain}")
        return


def _public_base_url(ctx: Context) -> str:
    domain = ctx.collected.get("domain") or ctx.state.domain
    if domain:
        return f"https://{domain}"
    return f"http://{ctx.host}"


def _caddy_site(ctx: Context) -> str:
    """Value for Caddy's site block matcher — real domain if set, else IP."""
    return ctx.collected.get("domain") or ctx.state.domain or ctx.host


def _render_env_local(ctx: Context) -> str:
    """Contents of packages/platform-ui/.env.local — read by Next.js."""
    fb = ctx.collected.get("firebase_config", {})
    lines = [
        "# Auto-generated by scripts/bootstrap-server.py",
        f"# Host: {ctx.host}   Generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
        "",
        f"NEXT_PUBLIC_FIREBASE_API_KEY={fb.get('apiKey', '')}",
        f"NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN={fb.get('authDomain', '')}",
        f"NEXT_PUBLIC_FIREBASE_PROJECT_ID={fb.get('projectId', '')}",
        f"NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET={fb.get('storageBucket', '')}",
        f"NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID={fb.get('messagingSenderId', '')}",
        f"NEXT_PUBLIC_FIREBASE_APP_ID={fb.get('appId', '')}",
        "",
        f"OPENROUTER_API_KEY={ctx.collected.get('OPENROUTER_API_KEY', '')}",
        f"OPENAI_API_KEY={ctx.collected.get('OPENAI_API_KEY', '')}",
        f"PLATFORM_API_KEY={ctx.collected.get('PLATFORM_API_KEY', '')}",
        f"APP_BASE_URL={_public_base_url(ctx)}",
        "NAMESPACE=",
        "",
    ]
    return "\n".join(lines)


def _render_compose_env(ctx: Context) -> str:
    """Contents of /opt/mediforce/.env — read by `docker compose` for ${VAR}
    substitution in docker-compose.prod.yml (build args + container env)."""
    fb = ctx.collected.get("firebase_config", {})
    openrouter = ctx.collected.get("OPENROUTER_API_KEY", "")
    lines = [
        "# Auto-generated by scripts/bootstrap-server.py",
        f"# Host: {ctx.host}   Generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
        "# Read by `docker compose` for ${VAR} substitution in docker-compose.prod.yml.",
        "",
        "# Firebase config — passed as build-args to platform-ui Dockerfile",
        f"NEXT_PUBLIC_FIREBASE_API_KEY={fb.get('apiKey', '')}",
        f"NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN={fb.get('authDomain', '')}",
        f"NEXT_PUBLIC_FIREBASE_PROJECT_ID={fb.get('projectId', '')}",
        f"NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET={fb.get('storageBucket', '')}",
        f"NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID={fb.get('messagingSenderId', '')}",
        f"NEXT_PUBLIC_FIREBASE_APP_ID={fb.get('appId', '')}",
        f"NEXT_PUBLIC_APP_URL={_public_base_url(ctx)}",
        "",
        "# Runtime env for platform-ui / agent-worker containers",
        f"PLATFORM_API_KEY={ctx.collected.get('PLATFORM_API_KEY', '')}",
        f"SECRETS_ENCRYPTION_KEY={ctx.collected.get('SECRETS_ENCRYPTION_KEY', '')}",
        f"DOCKER_OPENROUTER_API_KEY={openrouter}",
        "DOCKER_DEEPSEEK_API_KEY=",
        "",
        "# Caddy — site block matcher (real domain → Let's Encrypt cert, IP → self-signed)",
        f"DOMAIN={_caddy_site(ctx)}",
        "",
    ]
    return "\n".join(lines)


def _mask(value: str) -> str:
    if not value:
        return "(empty)"
    if len(value) <= 8:
        return "…" * len(value)
    return f"{value[:4]}…{value[-4:]} ({len(value)} chars)"


def _is_sensitive_key(key: str) -> bool:
    """A key name that should be masked in previews.

    NEXT_PUBLIC_* variables are intentionally client-visible (they end up in
    the browser bundle at build time), so showing them unmasked is fine and
    helps the operator sanity-check what's being uploaded. Everything else
    whose name carries a secret-shaped marker gets masked.
    """
    if key.startswith("NEXT_PUBLIC_"):
        return False
    upper = key.upper()
    return any(marker in upper for marker in ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"))


def _preview_env(rendered: str) -> str:
    out_lines: list[str] = []
    for line in rendered.splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, val = line.partition("=")
            if _is_sensitive_key(key.strip()):
                out_lines.append(f"{key}={_mask(val)}")
                continue
        out_lines.append(line)
    return "\n".join(out_lines)


def _upload_env_file(ctx: Context, rendered: str, remote_path: str) -> None:
    with tempfile.NamedTemporaryFile("w", delete=False) as tf:
        tf.write(rendered)
        tmp_path = Path(tf.name)
    os.chmod(tmp_path, 0o600)
    try:
        scp_upload(ctx, tmp_path, remote_path, mode="0600")
        # Only chown when uploading as root — if uploaded by deploy itself, the file
        # is already deploy:deploy and non-root can't chown.
        if ctx.user != "deploy":
            ssh(ctx, f"{_sudo_prefix(ctx)}chown deploy:deploy {shlex.quote(remote_path)}", check=True)
    finally:
        tmp_path.unlink(missing_ok=True)


def _ensure_api_keys(ctx: Context) -> None:
    """Prompt for keys not yet in ctx.collected. Idempotent.

    API keys are intentionally not persisted to local state — this is the
    authoritative place where they are collected, and step_env_local calls
    through here on resumed runs (when --from-step skipped step_api_keys).
    """
    if not ctx.collected.get("OPENROUTER_API_KEY"):
        ctx.collected["OPENROUTER_API_KEY"] = ask(
            "OpenRouter API key (starts with sk-or-…) — get one at https://openrouter.ai/keys",
            secret=True,
            validate=lambda v: _looks_like_key(v, "sk-or-"),
        )
        ok("OpenRouter key accepted")

    if "OPENAI_API_KEY" not in ctx.collected:
        if confirm("Provide an OpenAI API key (sk-…)? Optional — used by some agent plugins.", default=False):
            ctx.collected["OPENAI_API_KEY"] = ask(
                "OpenAI API key",
                secret=True,
                validate=lambda v: _looks_like_key(v, "sk-"),
            )
            ok("OpenAI key accepted")
        else:
            ctx.collected["OPENAI_API_KEY"] = ""

    if not ctx.collected.get("PLATFORM_API_KEY"):
        ctx.collected["PLATFORM_API_KEY"] = secrets.token_urlsafe(32)
        ok("PLATFORM_API_KEY auto-generated (32 bytes base64url)")

    if not ctx.collected.get("SECRETS_ENCRYPTION_KEY"):
        ctx.collected["SECRETS_ENCRYPTION_KEY"] = secrets.token_hex(32)
        ok("SECRETS_ENCRYPTION_KEY auto-generated (32 bytes hex) — back this up; losing it makes stored workflow secrets unrecoverable")


def step_env_local(ctx: Context) -> None:
    # --- Hydrate firebase config from state on resumed runs ---
    if not ctx.collected.get("firebase_config"):
        if ctx.state.firebase_web_config:
            ctx.collected["firebase_config"] = ctx.state.firebase_web_config
            info(f"Loaded Firebase web SDK config from state ({ctx.state.firebase_project_id})")
        elif ctx.state.firebase_project_id and ctx.state.firebase_account:
            info("State has project but no web config — re-fetching from Firebase CLI")
            config = _firebase_get_web_config(
                ctx, ctx.state.firebase_account, ctx.state.firebase_project_id,
            )
            ctx.collected["firebase_config"] = config
            ctx.state.firebase_web_config = config
            ctx.state.save()
        else:
            error("Firebase config missing from memory and state — rerun step 8 first (--from-step 8).")
            raise SystemExit(1)

    # --- Re-prompt for API keys not collected in this session ---
    # Secrets aren't in state by design, so on --from-step ≥ 11 they're empty.
    # Running through the same collection flow keeps the script the single
    # source of prompts (no server-side read, no silent empty uploads).
    if not ctx.collected.get("OPENROUTER_API_KEY"):
        info("API keys weren't collected this session (resumed past step 9) — prompting now.")
        _ensure_api_keys(ctx)

    env_local = _render_env_local(ctx)
    compose_env = _render_compose_env(ctx)

    print()
    info("Two files will be written on the server:")
    info(f"  1. {REMOTE_DEPLOY_DIR}/packages/platform-ui/.env.local  — read by Next.js")
    info(f"  2. {REMOTE_DEPLOY_DIR}/.env                             — read by docker compose for ${{VAR}} substitution")
    print()
    print(dim("  ── preview: packages/platform-ui/.env.local (secrets masked) ──"))
    for line in _preview_env(env_local).splitlines():
        print(f"  {dim(line)}")
    print()
    print(dim("  ── preview: /opt/mediforce/.env (secrets masked) ──"))
    for line in _preview_env(compose_env).splitlines():
        print(f"  {dim(line)}")
    print()
    if not confirm("Upload both files?", default=True):
        raise SystemExit("aborted before env upload")

    if ctx.dry_run:
        info(f"[dry-run] would write {len(env_local)} + {len(compose_env)} bytes to the two paths")
        return

    _upload_env_file(ctx, env_local, f"{REMOTE_DEPLOY_DIR}/packages/platform-ui/.env.local")
    ok(f"uploaded packages/platform-ui/.env.local (0600, owned by deploy)")
    _upload_env_file(ctx, compose_env, f"{REMOTE_DEPLOY_DIR}/.env")
    ok(f"uploaded /opt/mediforce/.env (0600, owned by deploy)")


def step_firewall(ctx: Context) -> None:
    sp = _sudo_prefix(ctx)
    status = ssh(ctx, f"{sp}ufw status 2>/dev/null || true")
    if "Status: active" in status.stdout and \
       "22/tcp" in status.stdout and \
       "80/tcp" in status.stdout and \
       "443/tcp" in status.stdout:
        ok("UFW already active with 22/80/443 allowed")
        return
    if ctx.dry_run:
        info("[dry-run] would allow 22, 80, 443 and enable UFW")
        return
    script = (
        f"{sp}ufw allow 22/tcp && "
        f"{sp}ufw allow 80/tcp && "
        f"{sp}ufw allow 443/tcp && "
        f"{sp}ufw --force enable && "
        f"{sp}ufw status verbose"
    )
    result = ssh(ctx, script, capture=True)
    if not result.ok:
        raise RuntimeError(f"ufw failed: {result.stderr.strip()}")
    ok("UFW active with 22, 80, 443 allowed")


def step_first_deploy(ctx: Context) -> None:
    # Sanity: docker-compose.prod.yml present?
    probe = ssh(ctx, f"test -f {REMOTE_DEPLOY_DIR}/docker-compose.prod.yml && echo YES || echo NO")
    if "YES" not in probe.stdout:
        error("docker-compose.prod.yml is missing from the repo — can't run deploy.sh.")
        info("Expected at: {}/docker-compose.prod.yml".format(REMOTE_DEPLOY_DIR))
        if not confirm("Continue anyway (will likely fail)?", default=False):
            raise SystemExit(1)

    if ctx.dry_run:
        info("[dry-run] would run deploy.sh on the server")
        return

    warn("This step triggers the full Docker build on the server — can take 5-15 minutes on first run.")
    if not confirm("Start the deploy now?", default=True):
        raise SystemExit("aborted before first deploy")

    # If we're connected as deploy, call deploy.sh directly; otherwise hop through
    # sudo -u deploy so the build/compose commands run under the right user.
    if ctx.user == "deploy":
        deploy_cmd = f"cd {REMOTE_DEPLOY_DIR} && bash scripts/deploy.sh 2>&1"
    else:
        deploy_cmd = (
            f"sudo -u deploy bash -c 'cd {REMOTE_DEPLOY_DIR} && "
            "bash scripts/deploy.sh 2>&1'"
        )
    # NOTE: scripts/deploy.sh expects to be run as the owner of /opt/mediforce/.git
    # and writes /var/log/mediforce-deploy.log. It also calls `docker compose` —
    # deploy is in the docker group, so that works after re-login. To force a
    # fresh shell session (so group membership picks up), we use `sudo -u`.
    result = ssh(ctx, deploy_cmd, stream=True)
    if result.rc != 0:
        raise RuntimeError(f"deploy.sh exited with rc={result.rc} — check /var/log/mediforce-deploy.log on the server")
    ok("deploy.sh completed")


def step_smoke_test(ctx: Context) -> None:
    # Check compose ps first — gives quick visibility on container state.
    ps = ssh(ctx, f"cd {REMOTE_DEPLOY_DIR} && docker compose -f docker-compose.prod.yml ps --format json 2>/dev/null || true")
    # Compose emits line-delimited JSON in older versions and a JSON array
    # from v2.20+ (when stdout is not a TTY — always the case over ssh).
    raw = ps.stdout.strip()
    entries: list[dict] = []
    if raw.startswith("["):
        try:
            entries = json.loads(raw)
        except json.JSONDecodeError:
            pass
    else:
        for line in raw.splitlines():
            if not line.startswith("{"):
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    if entries:
        info(f"Running containers: {len(entries)}")
        for entry in entries:
            state = entry.get("State", "?")
            service = entry.get("Service", entry.get("Name", "?"))
            symbol = "✓" if state == "running" else "!"
            print(f"    {symbol} {service}: {state}")

    # Hit the platform-ui over HTTP from the remote machine (avoids firewall issues on client).
    probe_cmd = (
        "for port in 80 3000 9003; do "
        "code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:$port/ || echo 000); "
        "echo \"$port $code\"; "
        "done"
    )
    probe = ssh(ctx, probe_cmd)
    reachable: list[tuple[int, str]] = []
    for line in probe.stdout.strip().splitlines():
        try:
            port_s, code = line.split()
            port = int(port_s)
            reachable.append((port, code))
            marker = "✓" if code.startswith("2") or code.startswith("3") else "!"
            print(f"    {marker} localhost:{port} — HTTP {code}")
        except ValueError:
            continue

    success = any(code.startswith(("2", "3")) for _, code in reachable)
    public_url = _public_base_url(ctx)
    if success:
        ok(f"App responded on {ctx.host}. Try: {public_url}")
    else:
        warn("No port returned a 2xx/3xx response — the app may still be starting. Check:")
        info("  ssh root@{} 'docker compose -f {}/docker-compose.prod.yml logs --tail 50'".format(ctx.host, REMOTE_DEPLOY_DIR))

    # If a domain is configured, verify public HTTPS reachability from outside the
    # server too (catches firewall, DNS, and Caddy cert provisioning problems).
    # Retry with backoff — Caddy's first ACME HTTP-01 can take minutes under
    # rate limits or while DNS propagates.
    domain = ctx.collected.get("domain") or ctx.state.domain
    if domain:
        _probe_public_url_with_retry(ctx, public_url, attempts=3, wait_seconds=120)


def _probe_public_url_with_retry(
    ctx: Context, public_url: str, *, attempts: int, wait_seconds: int,
) -> None:
    for attempt in range(1, attempts + 1):
        info(f"Attempt {attempt}/{attempts}: curl {public_url}")
        probe = run(
            ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}|%{ssl_verify_result}",
             "-m", "45", public_url],
            check=False,
        )
        if probe.ok and probe.stdout:
            code, _, ssl_rc = probe.stdout.partition("|")
            ssl_rc = ssl_rc.strip()
            if code.startswith(("2", "3")) and ssl_rc == "0":
                ok(f"{public_url} → HTTP {code}, TLS verified")
                return
            if code.startswith(("2", "3")):
                warn(f"{public_url} → HTTP {code} but TLS verify returned {ssl_rc} (self-signed or pending LE cert)")
                # Self-signed while LE is pending is a real transient — keep retrying.
                last_reason = f"TLS verify rc={ssl_rc}"
            else:
                warn(f"{public_url} → HTTP {code or 'no response'} (ssl_rc={ssl_rc})")
                last_reason = f"HTTP {code or 'no response'}"
        else:
            warn(f"Couldn't reach {public_url} — curl failed ({probe.stderr.strip()[:120]})")
            last_reason = "curl failed"

        if attempt == attempts:
            break

        info(f"Waiting {wait_seconds}s before retry — press Ctrl+C to stop waiting and finish.")
        try:
            # Wake up often so Ctrl+C feels responsive.
            for _ in range(wait_seconds):
                time.sleep(1)
        except KeyboardInterrupt:
            warn("Interrupted — skipping remaining retries.")
            break

    warn(f"Public URL didn't respond after {attempt} attempt(s). Last reason: {last_reason}")
    info("Investigate with:")
    info(f"  ssh {ctx.user}@{ctx.host} 'docker compose -f {REMOTE_DEPLOY_DIR}/docker-compose.prod.yml logs caddy --tail 80'")


STEPS: list[tuple[str, str, Callable[[Context], None]]] = [
    ("local_prereqs",    "Local tooling",                        step_local_prereqs),
    ("target_server",    "Target server + SSH access",           step_target_server),
    ("system_packages",  "System packages (apt)",                step_system_packages),
    ("docker",           "Docker CE + compose plugin",           step_docker),
    ("deploy_user",      "deploy user",                          step_deploy_user),
    ("github_access",    "GitHub deploy key",                    step_github_access),
    ("clone_repo",       "Clone repo to /opt/mediforce",         step_clone_repo),
    ("firebase",         "Firebase project + web SDK config",    step_firebase),
    ("api_keys",         "API keys",                             step_api_keys),
    ("domain",           "Domain",                               step_domain),
    ("env_local",        "Assemble and upload env files",        step_env_local),
    ("firewall",         "Firewall (UFW)",                       step_firewall),
    ("first_deploy",     "First deploy (running scripts/deploy.sh)", step_first_deploy),
    ("smoke_test",       "Smoke test",                           step_smoke_test),
]


# ──────────────────────────────────────────────────────────────────────────
# Orchestration
# ──────────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", help="Target server IP or hostname (asked if omitted).")
    p.add_argument("--user", default="root", help="Remote user (default: root).")
    p.add_argument("--ssh-key", help="Path to SSH private key for --user@--host.")
    p.add_argument("--repo", help=f"GitHub repo to deploy, e.g. Org/Name (default: {DEFAULT_REPO}).")
    p.add_argument("--branch", help=f"Branch to deploy (default: {DEFAULT_BRANCH}).")
    p.add_argument("--from-step", type=int, help="Skip to step number N (1-based).")
    p.add_argument("--resume", action="store_true", help="Force resume prompt even if state looks fresh.")
    p.add_argument("--dry-run", action="store_true", help="Describe actions without making changes.")
    return p.parse_args()


def welcome() -> None:
    print()
    print(bold(cyan("╔══════════════════════════════════════════════════════════════╗")))
    print(bold(cyan("║  mediforce — interactive server bootstrap                    ║")))
    print(bold(cyan("╚══════════════════════════════════════════════════════════════╝")))
    print()
    print("  This will guide a fresh Ubuntu 22.04+ box to a running deploy.")
    print(f"  State is saved at {STATE_DIR}/bootstrap-<host>.json and is resumable.")
    print()


def resolve_start_index(args: argparse.Namespace, state: State) -> int:
    """Determine which step to start from."""
    if args.from_step:
        if args.from_step < 1 or args.from_step > len(STEPS):
            raise SystemExit(
                f"--from-step {args.from_step} out of range (1..{len(STEPS)})"
            )
        return args.from_step - 1
    if state.completed_steps:
        last = state.last_step
        remaining = [n for n, _, _ in STEPS if n not in state.completed_steps]
        info(f"Resuming — last completed step: {last!r}. Remaining: {len(remaining)}")
        if args.resume or confirm("Continue from there?", default=True):
            # First step whose name isn't in completed_steps. Using the length
            # of completed_steps would silently skip steps when completion was
            # non-contiguous (e.g. after a prior `--from-step N` run).
            return next(
                (i for i, (n, _, _) in enumerate(STEPS) if n not in state.completed_steps),
                len(STEPS),
            )
        if confirm("Start over from step 1?", default=False):
            state.completed_steps.clear()
            state.last_step = ""
            state.save()
            return 0
        raise SystemExit("Nothing to do.")
    return 0


REPO_SENSITIVE_STEPS = ("github_access", "clone_repo", "first_deploy", "smoke_test")


def _resolve_repo_and_branch(args: argparse.Namespace, state: State) -> None:
    """Reconcile --repo / --branch with what's in state.

    Precedence: CLI arg > state > default. Changing the repo on a state file
    that already tracks one requires confirmation, invalidates the deploy-key
    ID, and drops completed-step markers for steps whose side-effects are tied
    to a specific remote.
    """
    state.branch = args.branch or state.branch or DEFAULT_BRANCH

    effective_repo = args.repo or state.repo or DEFAULT_REPO
    if state.repo and effective_repo != state.repo:
        warn(f"Repo switch: {state.repo!r} → {effective_repo!r}")
        info("This will rewire deploy key, remote, and trigger a redeploy.")
        if not confirm("Switch the deployment to this repo?", default=True):
            raise SystemExit("aborted at repo switch")
        state.github_deploy_key_id = None
        state.completed_steps = [s for s in state.completed_steps if s not in REPO_SENSITIVE_STEPS]

    state.repo = effective_repo
    state.save()


def main() -> int:
    args = parse_args()
    welcome()

    host = args.host
    if not host:
        host = ask("Target server IP or hostname")
    state = State.load(host)
    state.user = args.user
    if args.ssh_key:
        state.ssh_key_path = str(Path(args.ssh_key).expanduser())
    _resolve_repo_and_branch(args, state)

    info(f"Deploying {state.repo}@{state.branch} to {host}")

    ctx = Context(
        host=host,
        user=args.user,
        ssh_key_path=Path(state.ssh_key_path).expanduser() if state.ssh_key_path else Path(),
        state=state,
        dry_run=args.dry_run,
    )

    start = resolve_start_index(args, state)
    try:
        for idx, (name, title, fn) in enumerate(STEPS[start:], start=start + 1):
            section(f"{idx}. {title}")
            fn(ctx)
            state.mark(name)
    except KeyboardInterrupt as exc:
        print()
        warn(f"Aborted: {exc}")
        info(f"State saved to {STATE_DIR}/bootstrap-{state.host}.json — rerun to resume.")
        return 130

    print()
    ok(bold("All steps completed."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
