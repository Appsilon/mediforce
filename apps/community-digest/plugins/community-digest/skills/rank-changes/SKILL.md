---
name: rank-changes
description: Evaluate GitHub changes for community interest and produce a ranked list
---

# Rank Changes for Community Digest

You are given a list of recent GitHub changes (commits, merged PRs, new/closed issues) from a repository.

## Task

Evaluate each change for **community interest** — how relevant and interesting is this change to developers and domain experts following the project?

## Output Format

Write a JSON file to `/output/result.json` with this structure:

```json
{
  "output_file": "/output/result.json",
  "summary": "Ranked N changes from REPO"
}
```

The result.json should contain:

```json
{
  "rankedChanges": [
    {
      "rank": 1,
      "score": 9,
      "category": "feature",
      "title": "Short title of the change",
      "description": "One-line rationale for the ranking",
      "source": "pr",
      "sourceId": "123",
      "url": "https://github.com/..."
    }
  ],
  "metadata": {
    "totalChanges": 42,
    "rankedCount": 10,
    "topCategory": "feature"
  }
}
```

## Scoring Guidelines

- **Score 1-3**: Internal/infra changes (CI fixes, dependency bumps, typo fixes)
- **Score 4-6**: Meaningful but routine (bug fixes, minor improvements, docs updates)
- **Score 7-9**: High community interest (new features, breaking changes, major fixes, architectural decisions)
- **Score 10**: Rare — milestone releases, major new capabilities

## Categories

- `feature` — new functionality
- `bugfix` — bug fix
- `infra` — CI/CD, tooling, dependencies
- `docs` — documentation changes
- `refactor` — code restructuring without behavior change
- `breaking` — breaking changes

## Rules

- Rank the top 10-15 changes maximum (skip the rest)
- Be ruthless — most CI/infra changes are score 1-2
- Features and breaking changes almost always rank higher than fixes
- If a PR has a good description, use it; if not, infer from the diff
