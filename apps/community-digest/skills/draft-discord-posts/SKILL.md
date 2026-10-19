---
name: draft-discord-posts
description: Write Discord posts from ranked GitHub changes
---

# Draft Discord Posts

You are given a ranked list of GitHub changes with scores and categories. Your job is to write Discord posts that communicate the most interesting changes to the community.

## Task

From the ranked changes, draft **two versions** of a Discord update post:

1. **Short** — 2-4 sentences. For small updates or keeping the channel active.
2. **Detailed** — 5-8 sentences. For meaningful progress or sparking a discussion.

Both should stand on their own.

## Output Format

Write your result as one JSON object to `/output/result.json`:

```json
{
  "shortPost": "The short version of the Discord post...",
  "detailedPost": "The detailed version of the Discord post...",
  "changesIncluded": 5,
  "topChange": "Brief description of the #1 ranked change"
}
```

## Writing Rules

Follow the tone and style rules provided in the prompt's community tone section. The key principles:

- State what was done, why it matters, what's next
- Be specific — mention the actual component, step, or problem
- Sound like an engineer talking to peers
- End with a real question or ask that invites a useful answer
- If the update is small, the post should be small
- Don't explain what MediForce is — the audience knows

## Focus

- Lead with the highest-scored changes
- Group related changes when natural
- Skip score 1-3 items unless nothing else is available
- Include links to PRs/commits when referencing specific changes
