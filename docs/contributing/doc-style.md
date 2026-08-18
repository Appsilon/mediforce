---
status: living
audience: agents
last_reviewed: 2026-08-18
---

# Doc writing style: caveman

Applies to docs agents read in-session — `reference/`, `testing/`, gotchas,
skill files, `AGENTS.md`. ~60-75% fewer tokens than full prose, substance
intact. Every token costs context.

Human-facing prose is exempt: `README.md`, `concepts/`, `guides/`, and ADR
narrative are written for people reading once, not agents reading every
session. Terseness there buys nothing and costs comprehension.

## Canonical prompt

From [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) (April 2026):

```
Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".
```

Push hardest on tables and index rows. Ease off where a fragment would need
re-reading.

## Passthrough (never compress)

Frontmatter · code blocks · file paths · URLs · Zod/symbol/variable names ·
numbers · dates · version strings · section headers.

## When to break rule

When terseness breaks comprehension. Reader who can't parse a fragment =
failure mode.
