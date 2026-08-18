---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [app, community-digest, discord, github, cron]
---

**Scheduled workflow. Gathers GitHub activity → ranks changes → drafts Discord posts. Daily Mon–Fri 08:00 or manual.**

## Steps

File: `apps/community-digest/src/community-digest.wd.json`. Trigger: cron or manual.

1. `select-period` (human)
2. `gather-changes` (script, [`script-container`](../plugins/script-container.md))
3. `rank-changes` (agent — DeepSeek)
4. `draft-posts` (agent)
5. `post-to-discord` (agent)

## Container

Custom Docker image `mediforce-agent:community-digest` built from `apps/community-digest/container/Dockerfile`.

## Relationships

- Depends on: [`script-container`](../plugins/script-container.md), [`agent-runtime`](../packages/agent-runtime.md).

## Sources

- `apps/community-digest/src/community-digest.wd.json`
- `apps/community-digest/container/Dockerfile`
