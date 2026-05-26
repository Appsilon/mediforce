---
name: self-review
description: Final check on your own changes before reporting a task done, opening a PR, or asking for review. Thin wrapper that spawns `/code-review --self` in a subagent. **MUST be invoked as a subagent** — a clean context yields an honest review; reviewing your own work inline produces blindspots. Triggers include "self review", "review my changes", "check my diff", "ready to commit", "ready for PR", "I'm done", "before I ship".
allowed-tools: Bash, Read, Glob, Grep, Agent
metadata:
  version: "2.0"
  domain: development
  complexity: intermediate
  tags: review, quality, pre-pr
---

# Self-Review

Thin wrapper around `/code-review --self`. All logic lives there: pre-flight (typecheck + affected tests), three-axis review (Standards / Spec / Big Picture), `git blame` gate on "pre-existing" excuses, SHIP / ITERATE verdict.

## Hard rule — invoke as subagent

If you wrote the code in this conversation, **STOP**. Spawn a subagent and have it run this skill. Reviewing your own work in the same context where you wrote it is unreliable — "I just wrote this, it must be good" assumptions don't carry to an outside reader.

From the main thread:

```
Spawn Agent (general-purpose) with prompt:
  Run /code-review --self on the current branch. Treat the diff as if a stranger wrote it.
  Verify every "pre-existing" claim with git blame before accepting it.
  Return the SHIP / ITERATE verdict and the full three-axis report.
```

That's the whole skill. See `.claude/skills/code-review/SKILL.md` for what `--self` mode does, the SHIP gate, and the pre-existing-excuse policy.
