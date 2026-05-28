---
name: self-review
description: Final check on your own changes before reporting a task done, opening a PR, or asking for review. Spawns a subagent that runs `/code-review` on the current branch — clean context, no "I just wrote this, it must be good" bias. Returns SHIP / ITERATE verdict. Triggers include "self review", "review my changes", "check my diff", "ready to commit", "ready for PR", "I'm done", "before I ship".
allowed-tools: Agent
metadata:
  version: "4.0"
  domain: development
  complexity: intermediate
  tags: review, quality, pre-pr
---

# Self-Review

## Step 1 — spawn the reviewer

Run this exact `Agent` call. `run_in_background: true` is non-negotiable — foreground blocks the harness.

```
Agent({
  subagent_type: "general-purpose",
  description: "Self-review current branch",
  run_in_background: true,
  prompt: "Run /code-review on the current branch. Return the full review verbatim plus a one-line SHIP or ITERATE verdict at the end."
})
```

While it runs, do not poll — you will be notified on completion.

## Step 2 — report back to the user

When the subagent returns, your reply MUST have two sections:

**What the reviewer said** — paste the subagent's findings verbatim (or a faithful summary if very long). Do not silently drop items you disagree with.

**My recommendations** — for each finding, state: address / defer / ignore, with a one-line reason. End with your own SHIP / ITERATE call.

The user decides what to act on. Your job is to surface everything the reviewer raised, then advise.
