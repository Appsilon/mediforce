---
name: self-review
description: Final check on your own changes before reporting a task done, opening a PR, or asking for review. Alias for `/code-review` with no args — which already spawns a subagent, auto-detects self mode, runs pre-flight + three-axis review, and returns SHIP / ITERATE. Triggers include "self review", "review my changes", "check my diff", "ready to commit", "ready for PR", "I'm done", "before I ship".
allowed-tools: Bash, Read, Glob, Grep, Agent
metadata:
  version: "3.0"
  domain: development
  complexity: intermediate
  tags: review, quality, pre-pr
---

# Self-Review

Alias for `/code-review` (no args). Run that. It already:

- Always spawns a subagent (clean context — no "I just wrote this, it must be good" bias).
- Auto-detects self mode when called with no args (own current branch vs main).
- Runs pre-flight (`pnpm typecheck` + `pnpm test:affected`).
- Runs the three-axis review (Standards / Spec / Big Picture).
- Applies the `git blame` gate on every "pre-existing" excuse.
- Returns SHIP / ITERATE verdict.

See `.claude/skills/code-review/SKILL.md` for the full spec.
