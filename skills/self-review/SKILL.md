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

Spawn a subagent (general-purpose) and tell it to run `/code-review` on the current branch — fresh context reviews honestly.
