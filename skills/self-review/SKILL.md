---
name: self-review
description: Final check on your own changes before reporting a task done, opening a PR, or asking for review. Spawns a subagent that runs `/code-review` on the current branch — clean context, no "I just wrote this, it must be good" bias. Returns SHIP / ITERATE verdict. Triggers include "self review", "review my changes", "check my diff", "ready to commit", "ready for PR", "I'm done", "before I ship".
allowed-tools: Agent
metadata:
  version: "3.0"
  domain: development
  complexity: intermediate
  tags: review, quality, pre-pr
---

# Self-Review

Spawn a subagent. Have it run `/code-review` on the current branch. Return the verdict.

```
Agent (general-purpose) prompt:
  Run /code-review on the current branch (no args → auto self mode).
  Treat the diff as if a stranger wrote it.
  Verify every "pre-existing" claim with git blame before accepting it.
  Return the full three-axis report + SHIP / ITERATE verdict.
```

That's it. Why a subagent: reviewing your own work in the same context where you wrote it is unreliable — "I just wrote this, it must be good" assumptions don't carry to an outside reader. A fresh context reviews honestly.

All review logic lives in `.claude/skills/code-review/SKILL.md`: pre-flight (`pnpm typecheck` + `pnpm test:affected`), three-axis review (Standards / Spec / Big Picture), `git blame` gate on "pre-existing" excuses, SHIP / ITERATE verdict.
