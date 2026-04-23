# Wiki writing style: caveman

Wiki prose in caveman. ~60–75% fewer tokens than full prose, substance intact. Agents read wiki in-session — every token costs context.

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

## Intensity

| Level | Use for |
|-------|---------|
| Lite | decisions, syntheses (need connective tissue) |
| Full (default) | entities, concepts, gotchas |
| Ultra | tables, index rows |

## Passthrough (never compress)

Frontmatter · code blocks · file paths · URLs · Zod/symbol/variable names · numbers · dates · version strings · section headers.

## When to break rule

When terseness breaks comprehension. Reader who can't parse a fragment = failure mode.
