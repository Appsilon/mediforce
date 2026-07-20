#!/usr/bin/env python3
"""Regenerate pharmaverse-governance.wd.json for the current Mediforce schema.

Source of truth stays as editable files in this package:
  - src/pharmaverse-governance.base.wd.json  (workflow graph, no skill text)
  - plugins/.../skills/*/SKILL.md             (agent instructions)

This script produces a self-contained, directly-registerable wd.json:
  1. Script steps use the current `script:` config block (no `agent:`, no autonomyLevel).
  2. Agent steps carry their skill inline via `agent.prompt` — no externalSkillsRepo,
     no public repo, no host-path skillsDir resolution.
  3. Agent steps route LLM auth through OpenRouter and pin an explicit model id.
"""

import json
import shutil
import subprocess
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent.parent
SKILLS = HERE / "plugins" / "pharmaverse-governance" / "skills"
SCRIPTS = HERE / "scripts"
REPO_ROOT = HERE.parent.parent
GOLDEN_IMAGE = "mediforce-golden-image"

OPENROUTER_ENV = {
    "OPENROUTER_API_KEY": "{{OPENROUTER_API_KEY}}",
    "ANTHROPIC_AUTH_TOKEN": "{{OPENROUTER_API_KEY}}",
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_API_KEY": "",
}
MODEL = "anthropic/claude-sonnet-4.5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def esbuild_bin() -> str:
    local = REPO_ROOT / "node_modules" / ".bin" / "esbuild"
    if local.exists():
        return str(local)
    found = shutil.which("esbuild")
    if found:
        return found
    raise SystemExit("esbuild not found (looked in repo node_modules and PATH).")


def transpile(script_ts: Path) -> str:
    """Strip TS types → runnable ESM (node builtins stay as external imports)."""
    result = subprocess.run(
        [esbuild_bin(), str(script_ts), "--format=esm", "--platform=node", "--target=node20"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def command_to_script(command: str) -> Path:
    """Map a base-wd command like `node /app/discover-packages.js` → discover-packages.ts."""
    js_name = command.split("/")[-1].strip()
    return SCRIPTS / (js_name[:-3] + ".ts" if js_name.endswith(".js") else js_name)


def inline_resolve() -> str:
    return read(SKILLS / "resolve-package-selection" / "SKILL.md")


def inline_recommendations() -> str:
    return read(SKILLS / "assess-recommendations" / "SKILL.md")


AGENT_PROMPTS = {
    "resolve-package-selection": inline_resolve,
    "assess-recommendations": inline_recommendations,
}


def main() -> None:
    base = json.loads(read(HERE / "src" / "pharmaverse-governance.base.wd.json"))

    for step in base["steps"]:
        executor = step.get("executor")
        if executor == "script":
            # Inline the transpiled script and run it on the golden image — no
            # custom image, no baked files. Drop the old agent/command shape.
            agent = step.pop("agent", None)
            step.pop("autonomyLevel", None)
            command = (agent or {}).get("command", "")
            script_ts = command_to_script(command)
            step["script"] = {
                "runtime": "javascript",
                "image": GOLDEN_IMAGE,
                "inlineScript": transpile(script_ts),
            }
        elif executor == "agent":
            build_prompt = AGENT_PROMPTS.get(step["id"])
            if build_prompt is None:
                continue
            agent = step.setdefault("agent", {})
            agent.pop("skill", None)
            agent.pop("skillsDir", None)
            agent["prompt"] = build_prompt()
            agent["model"] = MODEL
            step["env"] = dict(OPENROUTER_ENV)

    out = HERE / "src" / "pharmaverse-governance.wd.json"
    out.write_text(json.dumps(base, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")

    out_yaml = HERE / "src" / "pharmaverse-governance.wd.yaml"
    out_yaml.write_text(dump_yaml(base), encoding="utf-8")
    print(f"wrote {out_yaml}")


class _Literal(str):
    """Marker so PyYAML emits a string as a `|` block scalar."""


def _literal_representer(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", str(data), style="|")


yaml.add_representer(_Literal, _literal_representer)


def _blockify(value):
    """Render every multiline string as a `|` block scalar for readable YAML."""
    if isinstance(value, dict):
        return {k: _blockify(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_blockify(v) for v in value]
    if isinstance(value, str) and "\n" in value:
        return _Literal(value)
    return value


def dump_yaml(data: dict) -> str:
    return yaml.dump(
        _blockify(data),
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=4096,
    )


if __name__ == "__main__":
    main()
