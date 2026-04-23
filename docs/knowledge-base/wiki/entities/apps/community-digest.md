---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [app, community-digest, discord, github, cron]
---

**Scheduled workflow app that gathers GitHub activity, ranks changes, and drafts Discord posts. Runs daily Mon–Fri at 08:00 or on-demand.**

## Purpose

Automates the "what happened this week" update. Triggered by cron or manual dispatch. Uses the [`script-container`](../plugins/script-container.md) plugin (not an LLM plugin) for GitHub data gathering, then DeepSeek for ranking, then drafts Discord posts for human review before posting.

## Workflow definition

File: `apps/community-digest/src/community-digest.wd.json`.

Trigger: `cron` — daily 08:00 Mon–Fri — or manual.

Partial step list:
1. `select-period` (human)
2. `gather-changes` (script, `script-container`)
3. `rank-changes` (agent)
4. `draft-posts` (agent)
5. `post-to-discord` (agent)

## Container

Custom Docker image `mediforce-agent:community-digest`, built from `apps/community-digest/container/Dockerfile`.

## Relationships

- Depends on: [`script-container`](../plugins/script-container.md), [`agent-runtime`](../packages/agent-runtime.md).

## Sources

- `apps/community-digest/src/community-digest.wd.json`
- `apps/community-digest/container/Dockerfile`
